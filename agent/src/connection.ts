import WebSocket from 'ws';
import net from 'node:net';
import fs from 'node:fs/promises';
import {
  AGENT_PROTOCOL_VERSION,
  parseControlMessage,
  type AgentCommand,
  type AgentMessage,
} from '@nexpanel/shared';
import { agentWsUrl, type AgentConfig } from './config.js';
import { collectMetrics, collectSystemInfo } from './sysinfo.js';
import type { AppSupervisor } from './apps.js';
import type { FileService } from './files.js';
import type { ExecService } from './exec.js';
import type { Provisioner } from './provision.js';
import type { BackupManager } from './backups.js';
import type { Sandbox } from './sandbox.js';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface AgentServices {
  apps: AppSupervisor;
  files: FileService;
  exec: ExecService;
  provisioner: Provisioner;
  backups: BackupManager;
  sandbox: Sandbox;
}

/**
 * Maintains the outbound WebSocket connection to the control plane with
 * automatic reconnection, and dispatches incoming commands to services.
 */
export class AgentConnection {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private closed = false;

  constructor(
    private readonly config: AgentConfig,
    private readonly services: AgentServices,
  ) {}

  start(): void {
    this.connect();
    // App events stream to the control plane whenever connected.
  }

  stop(): void {
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close(1000, 'agent shutting down');
  }

  send(msg: AgentMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private connect(): void {
    if (this.closed) return;
    const url = agentWsUrl(this.config.panelUrl);
    console.log(`[agent] connecting to ${url}`);
    const ws = new WebSocket(url, { maxPayload: 32 * 1024 * 1024 });
    this.ws = ws;

    ws.on('open', async () => {
      try {
        const system = await collectSystemInfo();
        this.send({ t: 'hello', protocol: AGENT_PROTOCOL_VERSION, token: this.config.token, system });
      } catch (err) {
        console.error('[agent] failed to collect system info:', err);
        ws.close();
      }
    });

    ws.on('message', (raw) => {
      const msg = parseControlMessage(raw.toString());
      if (!msg) return;
      if (msg.t === 'hello_ack') {
        console.log(`[agent] registered as node ${msg.nodeId}`);
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.startHeartbeat(msg.heartbeatIntervalMs);
      } else if (msg.t === 'hello_reject') {
        console.error(`[agent] registration rejected: ${msg.reason}`);
        // Token problems are not transient — back off to the max.
        this.reconnectDelay = RECONNECT_MAX_MS;
      } else if (msg.t === 'cmd') {
        void this.handleCommand(msg.reqId, msg.cmd);
      }
    });

    const scheduleReconnect = () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.closed) return;
      setTimeout(() => this.connect(), this.reconnectDelay).unref();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    };
    ws.on('close', scheduleReconnect);
    ws.on('error', (err) => {
      console.error(`[agent] connection error: ${err.message}`);
      ws.close();
    });
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const beat = async () => {
      try {
        const metrics = await collectMetrics();
        this.send({ t: 'heartbeat', metrics, apps: this.services.apps.allStatuses() });
      } catch (err) {
        console.error('[agent] heartbeat failed:', err);
      }
    };
    void beat();
    this.heartbeatTimer = setInterval(() => void beat(), Math.max(1000, intervalMs));
  }

  private result(reqId: string, ok: boolean, data?: unknown, error?: string): void {
    this.send({ t: 'result', reqId, ok, ...(data !== undefined ? { data } : {}), ...(error ? { error } : {}) });
  }

  private stream(reqId: string, channel: 'stdout' | 'stderr' | 'progress', chunk: string): void {
    this.send({ t: 'stream', reqId, channel, chunk });
  }

  private async handleCommand(reqId: string, cmd: AgentCommand): Promise<void> {
    const s = this.services;
    try {
      switch (cmd.op) {
        case 'sys.info':
          return this.result(reqId, true, await collectSystemInfo());
        case 'sys.ports.check': {
          const free: number[] = [];
          for (const port of cmd.ports) {
            if (await isPortFree(port)) free.push(port);
          }
          return this.result(reqId, true, { free });
        }

        case 'app.provision':
          await s.provisioner.provision(cmd.spec, cmd.steps, (line) => this.stream(reqId, 'progress', line));
          return this.result(reqId, true, { appId: cmd.spec.appId });
        case 'app.sync':
          s.apps.setSpec(cmd.spec);
          return this.result(reqId, true, {});
        case 'app.start':
          await s.apps.startApp(cmd.appId);
          return this.result(reqId, true, {});
        case 'app.stop':
          await s.apps.stopApp(cmd.appId);
          return this.result(reqId, true, {});
        case 'app.kill':
          await s.apps.killApp(cmd.appId);
          return this.result(reqId, true, {});
        case 'app.delete': {
          await s.apps.stopApp(cmd.appId, { silent: true }).catch(() => undefined);
          s.apps.removeApp(cmd.appId);
          if (cmd.removeFiles) {
            await fs.rm(s.sandbox.appRoot(cmd.appId), { recursive: true, force: true });
            await fs.rm(`${s.sandbox.backupsDir}/${cmd.appId}`, { recursive: true, force: true });
          }
          return this.result(reqId, true, {});
        }
        case 'app.status':
          return this.result(reqId, true, { status: s.apps.statusOf(cmd.appId) });
        case 'app.input':
          s.apps.sendInput(cmd.appId, cmd.line);
          return this.result(reqId, true, {});
        case 'app.logs.tail':
          return this.result(reqId, true, { lines: s.apps.tailLogs(cmd.appId, cmd.lines) });

        case 'fs.list':
          return this.result(reqId, true, await s.files.list(cmd.appId, cmd.path));
        case 'fs.read':
          return this.result(reqId, true, await s.files.read(cmd.appId, cmd.path, cmd.maxBytes));
        case 'fs.write':
          await s.files.write(cmd.appId, cmd.path, cmd.content, cmd.base64);
          return this.result(reqId, true, {});
        case 'fs.delete':
          await s.files.delete(cmd.appId, cmd.path);
          return this.result(reqId, true, {});
        case 'fs.rename':
          await s.files.rename(cmd.appId, cmd.from, cmd.to);
          return this.result(reqId, true, {});
        case 'fs.mkdir':
          await s.files.mkdir(cmd.appId, cmd.path);
          return this.result(reqId, true, {});
        case 'fs.stat':
          return this.result(reqId, true, await s.files.stat(cmd.appId, cmd.path));
        case 'fs.search':
          return this.result(reqId, true, await s.files.search(cmd.appId, cmd.path, cmd.query, cmd.maxResults));
        case 'fs.download':
          return this.result(reqId, true, await s.files.download(cmd.appId, cmd.url, cmd.dest));

        case 'proc.exec': {
          const scopedId = cmd.scope.kind === 'workspace' ? `ws:${cmd.scope.id}` : cmd.scope.id;
          const result = await s.exec.run(
            {
              scopedId,
              command: cmd.command,
              cwd: cmd.cwd,
              env: cmd.env,
              timeoutMs: cmd.timeoutMs,
              maxOutputBytes: cmd.maxOutputBytes,
              shell: cmd.shell,
            },
            (channel, chunk) => this.stream(reqId, channel, chunk),
          );
          return this.result(reqId, true, result);
        }
        case 'proc.cancel':
          s.exec.cancel(cmd.execId);
          return this.result(reqId, true, {});

        case 'backup.create':
          return this.result(reqId, true, await s.backups.create(cmd.appId, cmd.backupId));
        case 'backup.restore':
          await s.backups.restore(cmd.appId, cmd.backupId);
          return this.result(reqId, true, {});
        case 'backup.delete':
          await s.backups.delete(cmd.appId, cmd.backupId);
          return this.result(reqId, true, {});

        case 'workspace.create':
          await fs.mkdir(s.sandbox.workspaceRoot(cmd.workspaceId), { recursive: true });
          return this.result(reqId, true, {});
        case 'workspace.delete':
          await fs.rm(s.sandbox.workspaceRoot(cmd.workspaceId), { recursive: true, force: true });
          return this.result(reqId, true, {});
      }
    } catch (err) {
      this.result(reqId, false, undefined, err instanceof Error ? err.message : String(err));
    }
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0' }, () => {
      server.close(() => resolve(true));
    });
  });
}
