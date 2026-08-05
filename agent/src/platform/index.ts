import { LinuxPlatform } from './linux.js';
import { WindowsPlatform } from './windows.js';

/**
 * Platform abstraction: everything OS-specific in the agent goes through this
 * interface, so adding macOS later means one new implementation.
 */
export interface Platform {
  readonly id: 'linux' | 'win32' | 'darwin';
  /** Shell used for exec commands: ['cmd.exe','/d','/s','/c'] or ['/bin/sh','-c'] */
  shellCommand(commandLine: string): { file: string; args: string[] };
  /** Kill an entire process tree. */
  killTree(pid: number, force: boolean): Promise<void>;
  /** Send a graceful termination signal to a process. */
  terminate(pid: number): void;
  pathSeparator: string;
}

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'win32':
      return new WindowsPlatform();
    case 'linux':
    case 'darwin': // POSIX behavior is close enough until a dedicated impl exists
      return new LinuxPlatform(process.platform);
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
