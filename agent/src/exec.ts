import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { newId } from '@nexpanel/shared';
import type { Platform } from './platform/index.js';
import type { Sandbox } from './sandbox.js';
import { joinCommandLine } from './quote.js';

export interface ExecRequest {
  scopedId: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  shell: boolean;
}

export interface ExecResult {
  execId: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * Runs one-off commands (builds, installs, git) inside a sandbox directory
 * with hard timeouts and output caps. Commands never inherit a cwd outside
 * the sandbox; the environment is passed explicitly.
 */
export class ExecService {
  private active = new Map<string, { kill: () => Promise<void> }>();

  constructor(
    private readonly sandbox: Sandbox,
    private readonly platform: Platform,
  ) {}

  cancel(execId: string): void {
    void this.active.get(execId)?.kill();
  }

  async run(req: ExecRequest, onOutput: (channel: 'stdout' | 'stderr', chunk: string) => void): Promise<ExecResult> {
    const cwd = this.sandbox.resolve(req.scopedId, req.cwd);
    fs.mkdirSync(cwd, { recursive: true });
    const execId = newId('exec');
    const started = Date.now();

    const commandLine = req.shell && req.command.length === 1 ? req.command[0]! : joinCommandLine(req.command, process.platform);
    const shell = this.platform.shellCommand(commandLine);

    const child = spawn(shell.file, shell.args, {
      cwd,
      env: { ...process.env, ...req.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32',
    });

    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;

    const cap = (channel: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (truncated) return;
      outputBytes += chunk.length;
      if (outputBytes > req.maxOutputBytes) {
        truncated = true;
        onOutput(channel, '\n[output truncated]\n');
        return;
      }
      onOutput(channel, chunk.toString('utf8'));
    };
    child.stdout?.on('data', cap('stdout'));
    child.stderr?.on('data', cap('stderr'));

    const kill = async () => {
      if (child.pid) await this.platform.killTree(child.pid, true);
    };
    this.active.set(execId, { kill });

    const timer = setTimeout(() => {
      timedOut = true;
      void kill();
    }, req.timeoutMs);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('error', (err) => {
        onOutput('stderr', `[nexpanel] spawn failed: ${err.message}\n`);
        resolve(null);
      });
      child.once('exit', (code) => resolve(code));
    });

    clearTimeout(timer);
    this.active.delete(execId);
    return { execId, exitCode, timedOut, truncated, durationMs: Date.now() - started };
  }
}
