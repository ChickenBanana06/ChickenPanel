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
    await fs.rm(appRoot, { recursive: true, force: true });
    await fs.mkdir(appRoot, { recursive: true });
    await tar.x({ file, cwd: appRoot });
  }

  async delete(appId: string, backupId: string): Promise<void> {
    await fs.rm(this.sandbox.backupFile(appId, backupId), { force: true });
  }
}
