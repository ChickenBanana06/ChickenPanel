import { newId, sha256Hex, parseAgentMessage, AGENT_PROTOCOL_VERSION, } from '@nexpanel/shared';
import { ApiError } from '../lib/errors.js';
const HEARTBEAT_INTERVAL_MS = 5000;
const OFFLINE_AFTER_MS = 20000;
const DEFAULT_CMD_TIMEOUT_MS = 60000;
/**
 * Hub for Node Agent connections. Agents dial in over WebSocket and
 * authenticate with their registration token; the control plane then issues
 * commands and receives events/heartbeats.
 */
export class NodeManager {
    db;
    realtime;
    agents = new Map();
    sweepTimer = null;
    constructor(db, realtime) {
        this.db = db;
        this.realtime = realtime;
    }
    start() {
        this.sweepTimer = setInterval(() => void this.sweepOffline(), 5000);
        this.sweepTimer.unref();
    }
    stop() {
        if (this.sweepTimer)
            clearInterval(this.sweepTimer);
        for (const agent of this.agents.values()) {
            agent.socket.close(1001, 'control plane shutting down');
        }
    }
    isOnline(nodeId) {
        return this.agents.has(nodeId);
    }
    get onlineNodeIds() {
        return [...this.agents.keys()];
    }
    /** Handle a new agent WebSocket connection (pre-auth: waits for hello). */
    handleConnection(socket) {
        let agent = null;
        const helloTimeout = setTimeout(() => {
            if (!agent)
                socket.close(4001, 'hello timeout');
        }, 10000);
        helloTimeout.unref();
        socket.on('message', (raw) => {
            const msg = parseAgentMessage(raw.toString('utf8'));
            if (!msg)
                return;
            if (!agent) {
                if (msg.t !== 'hello')
                    return;
                void this.authenticate(socket, msg)
                    .then((a) => {
                    if (!a)
                        return;
                    agent = a;
                    clearTimeout(helloTimeout);
                })
                    .catch(() => socket.close(1011, 'auth error'));
                return;
            }
            void this.handleMessage(agent, msg);
        });
        const cleanup = () => {
            clearTimeout(helloTimeout);
            if (agent)
                void this.handleDisconnect(agent);
            agent = null;
        };
        socket.on('close', cleanup);
        socket.on('error', cleanup);
    }
    async authenticate(socket, msg) {
        const reject = (reason) => {
            this.send(socket, { t: 'hello_reject', reason });
            socket.close(4003, reason);
            return null;
        };
        if (msg.protocol !== AGENT_PROTOCOL_VERSION)
            return reject('protocol version mismatch');
        const node = await this.db.node.findUnique({ where: { tokenHash: sha256Hex(msg.token) } });
        if (!node)
            return reject('invalid node token');
        const existing = this.agents.get(node.id);
        if (existing)
            existing.socket.close(4000, 'replaced by new connection');
        const agent = {
            nodeId: node.id,
            socket,
            pending: new Map(),
            lastHeartbeatAt: Date.now(),
        };
        this.agents.set(node.id, agent);
        const sys = msg.system;
        await this.db.node.update({
            where: { id: node.id },
            data: {
                status: 'ONLINE',
                platform: sys.platform,
                arch: sys.arch,
                osVersion: sys.osVersion,
                cpuModel: sys.cpuModel,
                cpuCores: sys.cpuCores,
                totalMemoryMb: Math.round(sys.totalMemoryMb),
                totalDiskMb: sys.totalDiskMb == null ? null : Math.round(sys.totalDiskMb),
                agentVersion: sys.agentVersion,
                capabilities: sys.capabilities,
                lastHeartbeatAt: new Date(),
            },
        });
        this.send(socket, { t: 'hello_ack', nodeId: node.id, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS });
        this.realtime.publish('nodes', 'node.online', { nodeId: node.id });
        this.realtime.publish(`node:${node.id}`, 'status', { status: 'ONLINE' });
        return agent;
    }
    async handleMessage(agent, msg) {
        switch (msg.t) {
            case 'hello':
                return; // already authenticated
            case 'heartbeat': {
                agent.lastHeartbeatAt = Date.now();
                await this.db.node
                    .update({
                    where: { id: agent.nodeId },
                    data: {
                        status: 'ONLINE',
                        lastHeartbeatAt: new Date(),
                        lastMetrics: msg.metrics,
                    },
                })
                    .catch(() => undefined);
                this.realtime.publish(`node:${agent.nodeId}`, 'metrics', msg.metrics);
                // Reconcile app statuses reported by the agent
                for (const [appId, status] of Object.entries(msg.apps)) {
                    await this.db.application
                        .updateMany({ where: { id: appId, nodeId: agent.nodeId }, data: { status } })
                        .catch(() => undefined);
                }
                return;
            }
            case 'result': {
                const pending = agent.pending.get(msg.reqId);
                if (!pending)
                    return;
                agent.pending.delete(msg.reqId);
                clearTimeout(pending.timer);
                pending.resolve({ ok: msg.ok, data: msg.data, error: msg.error });
                return;
            }
            case 'stream': {
                const pending = agent.pending.get(msg.reqId);
                pending?.onStream?.(msg.channel, msg.chunk);
                return;
            }
            case 'app.event': {
                await this.handleAppEvent(agent.nodeId, msg);
                return;
            }
        }
    }
    async handleAppEvent(nodeId, msg) {
        const ev = msg.event;
        if (ev.kind === 'status') {
            await this.db.application
                .updateMany({
                where: { id: msg.appId, nodeId },
                data: { status: ev.status, ...(ev.exitCode !== undefined ? { lastExitCode: ev.exitCode } : {}) },
            })
                .catch(() => undefined);
            this.realtime.publish(`app:${msg.appId}`, 'status', { status: ev.status, exitCode: ev.exitCode ?? null });
            this.realtime.publish('apps', 'app.status', { appId: msg.appId, status: ev.status });
        }
        else if (ev.kind === 'log') {
            this.realtime.publish(`app:${msg.appId}:console`, 'log', { stream: ev.stream, line: ev.line });
        }
        else if (ev.kind === 'metrics') {
            await this.db.application
                .updateMany({
                where: { id: msg.appId, nodeId },
                data: { lastMetrics: ev.metrics },
            })
                .catch(() => undefined);
            this.realtime.publish(`app:${msg.appId}`, 'metrics', ev.metrics);
        }
    }
    async handleDisconnect(agent) {
        if (this.agents.get(agent.nodeId) === agent) {
            this.agents.delete(agent.nodeId);
            await this.db.node
                .update({ where: { id: agent.nodeId }, data: { status: 'OFFLINE' } })
                .catch(() => undefined);
            this.realtime.publish('nodes', 'node.offline', { nodeId: agent.nodeId });
            this.realtime.publish(`node:${agent.nodeId}`, 'status', { status: 'OFFLINE' });
        }
        for (const [, pending] of agent.pending) {
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: 'agent disconnected' });
        }
        agent.pending.clear();
    }
    async sweepOffline() {
        const now = Date.now();
        for (const agent of this.agents.values()) {
            if (now - agent.lastHeartbeatAt > OFFLINE_AFTER_MS) {
                agent.socket.close(4008, 'heartbeat timeout');
            }
        }
    }
    send(socket, msg) {
        if (socket.readyState === socket.OPEN)
            socket.send(JSON.stringify(msg));
    }
    /**
     * Send a command to a node's agent and await the result.
     * Throws ApiError(503) when the node is offline.
     */
    async command(nodeId, cmd, opts) {
        const agent = this.agents.get(nodeId);
        if (!agent)
            throw ApiError.unavailable('Node is offline');
        const reqId = newId('req');
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_CMD_TIMEOUT_MS;
        const result = await new Promise((resolve) => {
            const timer = setTimeout(() => {
                agent.pending.delete(reqId);
                resolve({ ok: false, error: `agent command timed out after ${timeoutMs}ms` });
            }, timeoutMs);
            agent.pending.set(reqId, { resolve, timer, onStream: opts?.onStream });
            this.send(agent.socket, { t: 'cmd', reqId, cmd });
        });
        if (!result.ok)
            throw new ApiError(502, result.error ?? 'agent command failed', 'agent_error');
        return result.data;
    }
}
//# sourceMappingURL=node-manager.js.map