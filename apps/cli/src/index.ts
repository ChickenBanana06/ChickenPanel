#!/usr/bin/env node
/**
 * chickenpanel — control CLI for the ChickenPanel platform.
 *
 * Commands:
 *   chickenpanel install          Prepare the local installation (db init + migrations)
 *   chickenpanel start [service]  Start services (db, api, web, agent — default: db,api,web)
 *   chickenpanel stop  [service]  Stop services
 *   chickenpanel restart          Restart services
 *   chickenpanel status           Show service status
 *   chickenpanel logs <service>   Tail a service log file
 *   chickenpanel update           Rebuild after a git pull
 *   chickenpanel node register    Configure the local Node Agent with a panel URL + token
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function dataDir(): string {
  if (process.env.NEXPANEL_DATA_DIR) return process.env.NEXPANEL_DATA_DIR;
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'nexpanel');
}

const runDir = path.join(dataDir(), 'run');
const logDir = path.join(dataDir(), 'logs');

type ServiceName = 'db' | 'api' | 'web' | 'agent';

interface ServiceDef {
  name: ServiceName;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
}

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://nexpanel:nexpanel@127.0.0.1:5490/nexpanel';

const SERVICES: Record<ServiceName, ServiceDef> = {
  db: {
    name: 'db',
    command: [process.execPath, path.join(repoRoot, 'packages', 'database', 'dist', 'dev-server.js')],
    cwd: repoRoot,
    env: {
      // Reuse an existing dev data dir (repo/.pgdata) when present so
      // installs over a dev checkout keep their data; fresh installs use
      // the per-user data directory.
      NEXPANEL_PGDATA: fs.existsSync(path.join(repoRoot, '.pgdata'))
        ? path.join(repoRoot, '.pgdata')
        : path.join(dataDir(), 'pgdata'),
    },
  },
  api: {
    name: 'api',
    command: [process.execPath, path.join(repoRoot, 'apps', 'api', 'dist', 'index.js')],
    cwd: repoRoot,
    env: { DATABASE_URL: DB_URL },
  },
  web: {
    name: 'web',
    command: [
      process.execPath,
      path.join(repoRoot, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-p',
      process.env.NEXPANEL_WEB_PORT ?? '3000',
    ],
    cwd: path.join(repoRoot, 'apps', 'web'),
  },
  agent: {
    name: 'agent',
    command: [process.execPath, path.join(repoRoot, 'agent', 'dist', 'index.js')],
    cwd: repoRoot,
  },
};

function pidFile(name: ServiceName): string {
  return path.join(runDir, `${name}.pid`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(name: ServiceName): number | null {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), 'utf8').trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function startService(def: ServiceDef): void {
  const existing = readPid(def.name);
  if (existing && isRunning(existing)) {
    console.log(`[${def.name}] already running (pid ${existing})`);
    return;
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `${def.name}.log`), 'a');
  const [file, ...args] = def.command;
  const child = spawn(file!, args, {
    cwd: def.cwd,
    env: { ...process.env, ...def.env },
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  fs.writeFileSync(pidFile(def.name), String(child.pid));
  console.log(`[${def.name}] started (pid ${child.pid}) — logs: ${path.join(logDir, `${def.name}.log`)}`);
}

function stopService(name: ServiceName): void {
  const pid = readPid(name);
  if (!pid || !isRunning(pid)) {
    console.log(`[${name}] not running`);
    return;
  }
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already stopped
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already stopped
    }
  }
  fs.rmSync(pidFile(name), { force: true });
  console.log(`[${name}] stopped`);
}

function parseServices(arg: string | undefined, fallback: ServiceName[]): ServiceName[] {
  if (!arg) return fallback;
  const names = arg.split(',').map((s) => s.trim()) as ServiceName[];
  for (const n of names) {
    if (!SERVICES[n]) {
      console.error(`Unknown service: ${n} (valid: db, api, web, agent)`);
      process.exit(1);
    }
  }
  return names;
}

async function waitForPort(port: number, host: string, timeoutMs: number): Promise<boolean> {
  const net = await import('node:net');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const [, , command, arg1] = process.argv;

switch (command) {
  case 'install': {
    console.log('ChickenPanel install: initializing database and running migrations…');
    startService(SERVICES.db);
    const dbUp = await waitForPort(5490, '127.0.0.1', 60000);
    if (!dbUp) {
      console.error('Database did not come up on port 5490. Check logs.');
      process.exit(1);
    }
    execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@nexpanel/database', 'migrate:deploy'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: DB_URL },
      shell: process.platform === 'win32',
    });
    console.log('Install complete. Run "chickenpanel start" next.');
    break;
  }
  case 'start': {
    for (const name of parseServices(arg1, ['db', 'api', 'web'])) {
      startService(SERVICES[name]);
      if (name === 'db') await waitForPort(5490, '127.0.0.1', 60000);
      if (name === 'api') await waitForPort(Number(process.env.NEXPANEL_API_PORT ?? 4000), '127.0.0.1', 30000);
    }
    break;
  }
  case 'stop': {
    for (const name of parseServices(arg1, ['web', 'api', 'agent', 'db'])) stopService(name);
    break;
  }
  case 'restart': {
    const names = parseServices(arg1, ['web', 'api']);
    for (const name of names) stopService(name);
    await new Promise((r) => setTimeout(r, 1000));
    for (const name of names.slice().reverse()) startService(SERVICES[name]);
    break;
  }
  case 'status': {
    for (const name of Object.keys(SERVICES) as ServiceName[]) {
      const pid = readPid(name);
      const running = pid !== null && isRunning(pid);
      console.log(`${name.padEnd(6)} ${running ? `running (pid ${pid})` : 'stopped'}`);
    }
    break;
  }
  case 'logs': {
    const name = (arg1 ?? 'api') as ServiceName;
    const file = path.join(logDir, `${name}.log`);
    if (!fs.existsSync(file)) {
      console.error(`No log file for ${name}`);
      process.exit(1);
    }
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    console.log(lines.slice(-100).join('\n'));
    break;
  }
  case 'update': {
    console.log('Rebuilding ChickenPanel…');
    execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['install'], {
      cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32',
    });
    execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['-r', '--workspace-concurrency=1', 'build'], {
      cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32',
    });
    execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@nexpanel/database', 'migrate:deploy'], {
      cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32',
      env: { ...process.env, DATABASE_URL: DB_URL },
    });
    console.log('Update complete. Restart services with "chickenpanel restart".');
    break;
  }
  case 'node': {
    if (arg1 !== 'register') {
      console.error('Usage: chickenpanel node register <panel-url> <token>');
      process.exit(1);
    }
    const [, , , , panelUrl, token] = process.argv;
    if (!panelUrl || !token) {
      console.error('Usage: chickenpanel node register <panel-url> <token>');
      process.exit(1);
    }
    const agentData =
      process.env.NEXPANEL_AGENT_DATA ??
      (process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'nexpanel-agent')
        : path.join(os.homedir(), '.local', 'share', 'nexpanel-agent'));
    fs.mkdirSync(agentData, { recursive: true });
    fs.writeFileSync(path.join(agentData, 'agent.json'), JSON.stringify({ panelUrl, token }, null, 2), { mode: 0o600 });
    console.log(`Agent configured (${path.join(agentData, 'agent.json')}).`);
    console.log('Start it with: chickenpanel start agent');
    break;
  }
  default:
    console.log(`ChickenPanel CLI

Usage:
  chickenpanel install               Initialize database + run migrations
  chickenpanel start [svc[,svc]]     Start services (default: db,api,web)
  chickenpanel stop [svc[,svc]]      Stop services (default: all)
  chickenpanel restart [svc[,svc]]   Restart services (default: web,api)
  chickenpanel status                Show service status
  chickenpanel logs <svc>            Show last 100 log lines (db|api|web|agent)
  chickenpanel update                Reinstall deps, rebuild, migrate
  chickenpanel node register <url> <token>
                                     Configure the local Node Agent
`);
    if (command && command !== 'help' && command !== '--help') process.exit(1);
}
