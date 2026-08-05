import type { Backup } from '@nexpanel/database';
import type { AppContext } from '../context.js';
import { ApiError } from '../lib/errors.js';

export class BackupService {
  constructor(private readonly ctx: Omit<AppContext, 'ai' | 'apps'>) {
    ctx.tasks.registerRunner('backup.create', async (handle, data) => {
      const backupId = data.backupId as string;
      const backup = await ctx.db.backup.findUnique({ where: { id: backupId }, include: { application: true } });
      if (!backup) throw new Error('Backup record missing');
      await handle.log(`Creating backup of ${backup.application.name}`);
      try {
        const res = await ctx.nodes.command<{ sizeBytes: number }>(
          backup.application.nodeId,
          { op: 'backup.create', appId: backup.applicationId, backupId },
          { timeoutMs: 30 * 60 * 1000 },
        );
        await ctx.db.backup.update({
          where: { id: backupId },
          data: { status: 'completed', sizeBytes: BigInt(Math.round(res.sizeBytes)), completedAt: new Date() },
        });
        await handle.log('Backup complete');
        return { backupId, sizeBytes: res.sizeBytes };
      } catch (err) {
        await ctx.db.backup.update({
          where: { id: backupId },
          data: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
        });
        throw err;
      }
    });

    ctx.tasks.registerRunner('backup.restore', async (handle, data) => {
      const backupId = data.backupId as string;
      const backup = await ctx.db.backup.findUnique({ where: { id: backupId }, include: { application: true } });
      if (!backup) throw new Error('Backup record missing');
      if (backup.status !== 'completed') throw new Error('Backup is not in completed state');
      await handle.log(`Restoring backup ${backup.name} over ${backup.application.name}`);
      await ctx.nodes.command(
        backup.application.nodeId,
        { op: 'backup.restore', appId: backup.applicationId, backupId },
        { timeoutMs: 30 * 60 * 1000 },
      );
      await handle.log('Restore complete');
      return { backupId };
    });
  }

  async create(appId: string, name: string, userId?: string): Promise<{ backup: Backup; taskId: string }> {
    const app = await this.ctx.db.application.findUnique({ where: { id: appId } });
    if (!app) throw ApiError.notFound('Application not found');
    const backup = await this.ctx.db.backup.create({
      data: { applicationId: appId, name, status: 'creating' },
    });
    const task = await this.ctx.tasks.create({
      kind: 'backup.create',
      title: `Backup ${app.name}`,
      data: { backupId: backup.id },
      userId,
      applicationId: appId,
    });
    return { backup, taskId: task.id };
  }

  async restore(backupId: string, userId?: string): Promise<{ taskId: string }> {
    const backup = await this.ctx.db.backup.findUnique({ where: { id: backupId } });
    if (!backup) throw ApiError.notFound('Backup not found');
    const task = await this.ctx.tasks.create({
      kind: 'backup.restore',
      title: `Restore backup`,
      data: { backupId },
      userId,
      applicationId: backup.applicationId,
    });
    return { taskId: task.id };
  }
}
