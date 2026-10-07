import type { WebSocket } from 'ws';
import type { PrismaClient, Prisma } from '@nexpanel/database';
import {
  newId,
  sha256Hex,
  parseAgentMessage,
  type AgentCommand,
  type AgentMessage,
  type ControlMessage,
  AGENT_PROTOCOL_VERSION,
} from '@nexpanel/shared';
import type { RealtimeHub } from './realtime.js';
import { ApiError } from '../lib/errors.js';

const HEARTBEAT_INTERVAL_MS = 5000;
const OFFLINE_AFTER_MS = 20000;
const DEFAULT_CMD_TIMEOUT_MS = 60000;

interface PendingRequest {
  resolve: (value: { ok: boolean; data?: unknown; error?: string }) => void;
  timer: NodeJS.Timeout;
  onStream?: (channel: 'stdout' | 'stderr' | 'progress', chunk: string) => void;
}

interface ConnectedAgent {
  nodeId: string;
  socket: WebSocket;
  pending: Map<string, PendingRequest>;
  lastHeartbeatAt: number;
}

/**
 * Hub for Node Agent connections. Agents dial in over WebSocket and
 * authenticate with their registration token; the control plane then issues
 * commands and receives events/heartbeats.
 */
export class NodeManager {
  private agents = new Map<string, ConnectedAgent>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly realtime: RealtimeHub,
  ) {}

  start(): void {
    this.sweepTimer = setInterval(() => void this.sweepOffline(), 5000);
    this.sweepTimer.unref();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const agent of this.agents.values()) {
      agent.socket.close(1001, 'control plane shutting down');
    }
  }

  isOnline(nodeId: string): boolean {
    return this.agents.has(nodeId);
  }

  get onlineNodeIds(): string[] {
    return [...this.agents.keys()];
  }

  /** Handle a new agent WebSocket connection (pre-auth: waits for hello). */
  handleConnection(socket: WebSocket): void {
    let agent: ConnectedAgent | null = null;
    const helloTimeout = setTimeout(() => {
      if (!agent) socket.close(4001, 'hello timeout');
    }, 10000);
    helloTimeout.unref();

    socket.on('message', (raw: Buffer) => {
      const msg = parseAgentMessage(raw.toString('utf8'));
      if (!msg) return;
      if (!agent) {
        if (msg.t !== 'hello') return;
        void this.authenticate(socket, msg)
          .then((a) => {
            if (!a) return;
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
      if (agent) void this.handleDisconnect(agent);
      agent = null;
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  private async authenticate(
    socket: WebSocket,
    msg: Extract<AgentMessage, { t: 'hello' }>,
  ): Promise<ConnectedAgent | null> {
    const reject = (reason: string) => {
      this.send(socket, { t: 'hello_reject', reason });
      socket.close(4003, reason);
      return null;
    };
    if (msg.protocol !== AGENT_PROTOCOL_VERSION) return reject('protocol version mismatch');
    if (typeof msg.token !== 'string' || msg.token.length < 20 || msg.token.length > 200) {
      return reject('invalid node token');
    }
    const tokenHash = sha256Hex(msg.token);
    const node = await this.db.node.findUnique({ where: { tokenHash } });
    if (!node) return reject('invalid node token');
    const crypto = await import('node:crypto');
    const nodeHashBuf = Buffer.from(node.tokenHash, 'hex');
    const inputHashBuf = Buffer.from(tokenHash, 'hex');
    if (nodeHashBuf.length !== inputHashBuf.length || !crypto.timingSafeEqual(nodeHashBuf, inputHashBuf)) {
      return reject('invalid node token');
    }

    const existing = this.agents.get(node.id);
    if (existing) existing.socket.close(4000, 'replaced by new connection');

    const agent: ConnectedAgent = {
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
        capabilities: sys.capabilities as unknown as Prisma.InputJsonValue,
        lastHeartbeatAt: new Date(),
      },
    });
    this.send(socket, { t: 'hello_ack', nodeId: node.id, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS });
    this.realtime.publish('nodes', 'node.online', { nodeId: node.id });
    this.realtime.publish(`node:${node.id}`, 'status', { status: 'ONLINE' });
    return agent;
  }

  private async handleMessage(agent: ConnectedAgent, msg: AgentMessage): Promise<void> {
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
              lastMetrics: msg.metrics as unknown as Prisma.InputJsonValue,
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
        if (!pending) return;
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

  private async handleAppEvent(nodeId: string, msg: Extract<AgentMessage, { t: 'app.event' }>): Promise<void> {
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
    } else if (ev.kind === 'log') {
      this.realtime.publish(`app:${msg.appId}:console`, 'log', { stream: ev.stream, line: ev.line });
    } else if (ev.kind === 'metrics') {
      await this.db.application
        .updateMany({
          where: { id: msg.appId, nodeId },
          data: { lastMetrics: ev.metrics as unknown as Prisma.InputJsonValue },
        })
        .catch(() => undefined);
      this.realtime.publish(`app:${msg.appId}`, 'metrics', ev.metrics);
    }
  }

  private async handleDisconnect(agent: ConnectedAgent): Promise<void> {
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

  private async sweepOffline(): Promise<void> {
    const now = Date.now();
    for (const agent of this.agents.values()) {
      if (now - agent.lastHeartbeatAt > OFFLINE_AFTER_MS) {
        agent.socket.close(4008, 'heartbeat timeout');
      }
    }
  }

  private send(socket: WebSocket, msg: ControlMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  /**
   * Send a command to a node's agent and await the result.
   * Throws ApiError(503) when the node is offline.
   */
  async command<T = unknown>(
    nodeId: string,
    cmd: AgentCommand,
    opts?: {
      timeoutMs?: number;
      onStream?: (channel: 'stdout' | 'stderr' | 'progress', chunk: string) => void;
    },
  ): Promise<T> {
    const agent = this.agents.get(nodeId);
    if (!agent) throw ApiError.unavailable('Node is offline');
    const reqId = newId('req');
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_CMD_TIMEOUT_MS;

    const result = await new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        agent.pending.delete(reqId);
        resolve({ ok: false, error: `agent command timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      agent.pending.set(reqId, { resolve, timer, onStream: opts?.onStream });
      this.send(agent.socket, { t: 'cmd', reqId, cmd });
    });

    if (!result.ok) throw new ApiError(502, result.error ?? 'agent command failed', 'agent_error');
    return result.data as T;
  }
}
