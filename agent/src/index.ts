#!/usr/bin/env node
import path from 'node:path';
import { loadAgentConfig } from './config.js';
import { detectPlatform } from './platform/index.js';
import { Sandbox } from './sandbox.js';
import { AppSupervisor } from './apps.js';
import { FileService } from './files.js';
import { ExecService } from './exec.js';
import { Provisioner } from './provision.js';
import { BackupManager } from './backups.js';
import { AgentConnection } from './connection.js';

const config = loadAgentConfig();
const platform = detectPlatform();
const sandbox = new Sandbox(config.dataDir);
const files = new FileService(sandbox);
const exec = new ExecService(sandbox, platform);

// Connection is created after the supervisor so events can be forwarded.
let connection: AgentConnection;

const apps = new AppSupervisor(sandbox, platform, path.join(config.dataDir, 'state', 'specs.json'), {
  onStatus: (appId, status, exitCode) =>
    connection?.send({ t: 'app.event', appId, event: { kind: 'status', status, exitCode: exitCode ?? null } }),
  onLog: (appId, stream, line) => connection?.send({ t: 'app.event', appId, event: { kind: 'log', stream, line } }),
  onMetrics: (appId, metrics) => connection?.send({ t: 'app.event', appId, event: { kind: 'metrics', metrics } }),
});

const provisioner = new Provisioner(sandbox, files, exec, apps);
const backups = new BackupManager(sandbox, apps);

connection = new AgentConnection(config, { apps, files, exec, provisioner, backups, sandbox });

console.log(`[agent] NexPanel agent starting on ${platform.id} (data: ${config.dataDir})`);
apps.start();
connection.start();

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[agent] shutting down…');
  connection.stop();
  await apps.shutdown();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
