import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import type { Sandbox } from './sandbox.js';
import type { AppSupervisor } from './apps.js';

export class BackupManager {
  constructor(
    private readonly sandbox: Sandbox,
    private readonly apps: AppSupervisor,
  ) {}

  async create(appId: string, backupId: string): Promise<{ sizeBytes: number }> {
    const appRoot = this.sandbox.appRoot(appId);
    const file = this.sandbox.backupFile(appId, backupId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await tar.c({ gzip: true, file, cwd: appRoot }, ['.']);
    const st = await fs.stat(file);
    return { sizeBytes: st.size };
  }

  /** Restores over existing files. Refuses while the app is running. */
  async restore(appId: string, backupId: string): Promise<void> {
    if (this.apps.isRunning(appId)) {
      throw new Error('Stop the application before restoring a backup');
    }
    const file = this.sandbox.backupFile(appId, backupId);
    await fs.access(file);
    const appRoot = this.sandbox.appRoot(appId);
    const realAppRoot = await fs.realpath(appRoot);
    await tar.x({
      file,
      cwd: realAppRoot,
      filter: (entryPath, entry) => {
        if (path.isAbsolute(entryPath)) return false;
        const target = path.resolve(realAppRoot, entryPath);
        if (target !== realAppRoot && !target.startsWith(realAppRoot + path.sep)) {
          return false;
        }
        const e = entry as { type?: string; linkpath?: string };
        if (e.type === 'SymbolicLink' || e.type === 'Link') {
          const linkTarget = path.resolve(path.dirname(target), e.linkpath ?? '');
          if (linkTarget !== realAppRoot && !linkTarget.startsWith(realAppRoot + path.sep)) {
            return false;
          }
        }
        return true;
      },
    });
  }

  async delete(appId: string, backupId: string): Promise<void> {
    await fs.rm(this.sandbox.backupFile(appId, backupId), { force: true });
  }
}
