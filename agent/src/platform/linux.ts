import type { Platform } from './index.js';

export class LinuxPlatform implements Platform {
  readonly pathSeparator = '/';

  constructor(readonly id: 'linux' | 'darwin' = 'linux') {}

  shellCommand(commandLine: string): { file: string; args: string[] } {
    return { file: '/bin/sh', args: ['-c', commandLine] };
  }

  async killTree(pid: number, force: boolean): Promise<void> {
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    // Processes are spawned detached => they lead their own process group.
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  }

  terminate(pid: number): void {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
}
