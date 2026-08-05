import { execFile } from 'node:child_process';
import type { Platform } from './index.js';

export class WindowsPlatform implements Platform {
  readonly id = 'win32' as const;
  readonly pathSeparator = '\\';

  shellCommand(commandLine: string): { file: string; args: string[] } {
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    return { file: comspec, args: ['/d', '/s', '/c', commandLine] };
  }

  async killTree(pid: number, force: boolean): Promise<void> {
    await new Promise<void>((resolve) => {
      const args = ['/PID', String(pid), '/T'];
      if (force) args.push('/F');
      execFile('taskkill', args, () => resolve());
    });
  }

  terminate(pid: number): void {
    // Windows has no SIGTERM; kill() terminates the process. Graceful stops
    // should prefer stdin commands (handled by the supervisor).
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}
