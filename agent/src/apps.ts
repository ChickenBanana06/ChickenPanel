import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import si from 'systeminformation';
import type { AppRuntimeSpec, AppStatus, AppMetrics } from '@nexpanel/shared';
import type { Platform } from './platform/index.js';
import type { Sandbox } from './sandbox.js';
import { joinCommandLine } from './quote.js';

const LOG_BUFFER_LINES = 1000;
const RESTART_BACKOFF_MS = [2000, 5000, 10000, 30000, 60000];
const CRASH_WINDOW_MS = 10 * 60 * 1000;

export interface AppEvents {
  onStatus: (appId: string, status: AppStatus, exitCode?: number | null) => void;
  onLog: (appId: string, stream: 'stdout' | 'stderr', line: string) => void;
  onMetrics: (appId: string, metrics: AppMetrics) => void;
}

interface RunningApp {
  child: ChildProcess;
  startedAt: number;
  stopping: boolean;
}

/**
 * Supervises application processes on this node. Specs are persisted to disk
 * so apps can be restarted after an agent restart (auto-restart policies are
 * honored across agent restarts for apps that were running).
 */
export class AppSupervisor {
  private specs = new Map<string, AppRuntimeSpec>();
  private running = new Map<string, RunningApp>();
  private logs = new Map<string, { stream: 'stdout' | 'stderr'; line: string }[]>();
  private crashes = new Map<string, number[]>();
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private wasRunning = new Set<string>();
  private metricsTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sandbox: Sandbox,
    private readonly platform: Platform,
    private readonly stateFile: string,
    private readonly events: AppEvents,
  ) {
    this.loadState();
  }

  start(): void {
    this.metricsTimer = setInterval(() => void this.pollMetrics(), 10000);
    this.metricsTimer.unref();
    // Bring back apps that were running before the agent restarted.
    for (const appId of [...this.wasRunning]) {
      const spec = this.specs.get(appId);
      if (spec && spec.restartPolicy !== 'never') {
        void this.startApp(appId).catch(() => undefined);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    await Promise.all([...this.running.keys()].map((appId) => this.stopApp(appId, { silent: true })));
  }

  /* ---------------- State persistence ---------------- */

  private loadState(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as {
        specs: AppRuntimeSpec[];
        running: string[];
      };
      for (const spec of raw.specs ?? []) this.specs.set(spec.appId, spec);
      this.wasRunning = new Set(raw.running ?? []);
    } catch {
      // first run
    }
  }

  private saveState(): void {
    const data = {
      specs: [...this.specs.values()],
      running: [...this.running.keys()],
    };
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[agent] failed to persist state:', err);
    }
  }

  /* ---------------- Public API ---------------- */

  setSpec(spec: AppRuntimeSpec): void {
    this.specs.set(spec.appId, spec);
    this.saveState();
  }

  getSpec(appId: string): AppRuntimeSpec | undefined {
    return this.specs.get(appId);
  }

  removeApp(appId: string): void {
    this.specs.delete(appId);
    this.logs.delete(appId);
    this.crashes.delete(appId);
    const timer = this.restartTimers.get(appId);
    if (timer) clearTimeout(timer);
    this.restartTimers.delete(appId);
    this.saveState();
  }

  statusOf(appId: string): AppStatus {
    const run = this.running.get(appId);
    if (!run) return 'stopped';
    return run.stopping ? 'stopping' : 'running';
  }

  allStatuses(): Record<string, AppStatus> {
    const out: Record<string, AppStatus> = {};
    for (const appId of this.specs.keys()) out[appId] = this.statusOf(appId);
    return out;
  }

  isRunning(appId: string): boolean {
    return this.running.has(appId);
  }

  tailLogs(appId: string, lines: number): { stream: string; line: string }[] {
    const buf = this.logs.get(appId) ?? [];
    return buf.slice(-lines);
  }

  async startApp(appId: string): Promise<void> {
    const spec = this.specs.get(appId);
    if (!spec) throw new Error(`No spec for app ${appId}`);
    if (this.running.has(appId)) throw new Error('Application is already running');
    const pendingRestart = this.restartTimers.get(appId);
    if (pendingRestart) {
      clearTimeout(pendingRestart);
      this.restartTimers.delete(appId);
    }

    const cwd = this.sandbox.appRoot(appId);
    fs.mkdirSync(cwd, { recursive: true });

    this.events.onStatus(appId, 'starting');
    const commandLine = joinCommandLine(spec.startCommand, process.platform);
    const shell = this.platform.shellCommand(commandLine);

    const child = spawn(shell.file, shell.args, {
      cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      // The command line is already quoted for cmd.exe — prevent Node's re-quoting.
      windowsVerbatimArguments: process.platform === 'win32',
    });

    const run: RunningApp = { child, startedAt: Date.now(), stopping: false };
    this.running.set(appId, run);
    this.saveState();

    const append = (stream: 'stdout' | 'stderr') => (line: string) => {
      const buf = this.logs.get(appId) ?? [];
      buf.push({ stream, line: line.slice(0, 4000) });
      if (buf.length > LOG_BUFFER_LINES) buf.splice(0, buf.length - LOG_BUFFER_LINES);
      this.logs.set(appId, buf);
      this.events.onLog(appId, stream, line.slice(0, 4000));
    };
    if (child.stdout) readline.createInterface({ input: child.stdout }).on('line', append('stdout'));
    if (child.stderr) readline.createInterface({ input: child.stderr }).on('line', append('stderr'));

    child.once('spawn', () => {
      this.events.onStatus(appId, 'running');
    });
    child.once('error', (err) => {
      append('stderr')(`[nexpanel] failed to start: ${err.message}`);
      this.running.delete(appId);
      this.saveState();
      this.events.onStatus(appId, 'errored', null);
    });
    child.once('exit', (code, signal) => {
      const wasStopping = run.stopping;
      this.running.delete(appId);
      this.saveState();
      append('stdout')(`[nexpanel] process exited with code=${code ?? 'null'} signal=${signal ?? 'none'}`);
      if (wasStopping) {
        this.events.onStatus(appId, 'stopped', code);
        return;
      }
      const crashed = code !== 0;
      this.events.onStatus(appId, crashed ? 'crashed' : 'stopped', code);
      this.maybeAutoRestart(appId, crashed);
    });
  }

  private maybeAutoRestart(appId: string, crashed: boolean): void {
    const spec = this.specs.get(appId);
    if (!spec) return;
    const policy = spec.restartPolicy;
    if (policy === 'never') return;
    if (policy === 'on-crash' && !crashed) return;

    const now = Date.now();
    const history = (this.crashes.get(appId) ?? []).filter((t) => now - t < CRASH_WINDOW_MS);
    history.push(now);
    this.crashes.set(appId, history);
    if (history.length > RESTART_BACKOFF_MS.length) {
      this.appendSystemLog(appId, `auto-restart giving up after ${history.length - 1} attempts in 10 minutes`);
      return;
    }
    const delay = RESTART_BACKOFF_MS[Math.min(history.length - 1, RESTART_BACKOFF_MS.length - 1)]!;
    this.appendSystemLog(appId, `auto-restart in ${Math.round(delay / 1000)}s (attempt ${history.length})`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(appId);
      void this.startApp(appId).catch((err) => {
        this.appendSystemLog(appId, `auto-restart failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, delay);
    timer.unref();
    this.restartTimers.set(appId, timer);
  }

  private appendSystemLog(appId: string, message: string): void {
    const buf = this.logs.get(appId) ?? [];
    buf.push({ stream: 'stdout', line: `[nexpanel] ${message}` });
    this.logs.set(appId, buf);
    this.events.onLog(appId, 'stdout', `[nexpanel] ${message}`);
  }

  async stopApp(appId: string, opts?: { silent?: boolean }): Promise<void> {
    const run = this.running.get(appId);
    const spec = this.specs.get(appId);
    if (!run) return;
    run.stopping = true;
    if (!opts?.silent) this.events.onStatus(appId, 'stopping');

    const child = run.child;
    const graceMs = (spec?.stopGraceSeconds ?? 30) * 1000;

    if (spec?.stopMethod.type === 'stdin' && child.stdin?.writable) {
      child.stdin.write(spec.stopMethod.command + '\n');
    } else if (child.pid) {
      this.platform.terminate(child.pid);
    }

    const exited = await waitForExit(child, graceMs);
    if (!exited && child.pid) {
      this.appendSystemLog(appId, 'graceful stop timed out — force killing');
      await this.platform.killTree(child.pid, true);
      await waitForExit(child, 10000);
    }
  }

  async killApp(appId: string): Promise<void> {
    const run = this.running.get(appId);
    if (!run) return;
    run.stopping = true;
    if (run.child.pid) await this.platform.killTree(run.child.pid, true);
    await waitForExit(run.child, 10000);
  }

  sendInput(appId: string, line: string): void {
    const run = this.running.get(appId);
    if (!run) throw new Error('Application is not running');
    if (!run.child.stdin?.writable) throw new Error('Application stdin is not available');
    run.child.stdin.write(line + '\n');
  }

  /* ---------------- Metrics ---------------- */

  private async pollMetrics(): Promise<void> {
    if (this.running.size === 0) return;
    let processes: Awaited<ReturnType<typeof si.processes>>;
    try {
      processes = await si.processes();
    } catch {
      return;
    }
    const byPpid = new Map<number, { pid: number; cpu: number; memRss: number }[]>();
    const byPid = new Map<number, { pid: number; cpu: number; memRss: number }>();
    for (const p of processes.list) {
      const entry = { pid: p.pid, cpu: p.cpu ?? 0, memRss: p.memRss ?? 0 };
      byPid.set(p.pid, entry);
      const list = byPpid.get(p.parentPid) ?? [];
      list.push(entry);
      byPpid.set(p.parentPid, list);
    }
    for (const [appId, run] of this.running) {
      const rootPid = run.child.pid;
      if (!rootPid) continue;
      let cpu = 0;
      let memKb = 0;
      const queue = [rootPid];
      const seen = new Set<number>();
      while (queue.length > 0) {
        const pid = queue.shift()!;
        if (seen.has(pid)) continue;
        seen.add(pid);
        const self = byPid.get(pid);
        if (self) {
          cpu += self.cpu;
          memKb += self.memRss;
        }
        for (const c of byPpid.get(pid) ?? []) queue.push(c.pid);
      }
      const metrics: AppMetrics = {
        cpuPercent: Math.round(cpu * 10) / 10,
        memoryMb: Math.round(memKb / 1024),
        diskMb: null,
        uptimeSeconds: Math.round((Date.now() - run.startedAt) / 1000),
        pid: rootPid,
      };
      this.events.onMetrics(appId, metrics);
    }
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}
