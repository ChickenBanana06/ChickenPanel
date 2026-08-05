import { Prisma } from '@nexpanel/database';
import type { PrismaClient, Task } from '@nexpanel/database';
import type { RealtimeHub } from './realtime.js';

export interface TaskHandle {
  id: string;
  log: (message: string, level?: 'info' | 'warn' | 'error') => Promise<void>;
  setProgress: (progress: number) => Promise<void>;
  /** Throws TaskCancelledError if the task has been cancelled. */
  checkCancelled: () => void;
}

export class TaskCancelledError extends Error {
  constructor() {
    super('Task cancelled');
    this.name = 'TaskCancelledError';
  }
}

export type TaskRunner = (handle: TaskHandle, data: Record<string, unknown>) => Promise<unknown>;

/**
 * Persistent task system. Tasks are stored in PostgreSQL, run in-process with
 * bounded concurrency, and survive browser refreshes (they are fully
 * server-side). On boot, tasks left in `running` state from a previous
 * process are marked failed with a retry hint.
 */
export class TaskService {
  private runners = new Map<string, TaskRunner>();
  private cancelRequested = new Set<string>();
  private running = new Set<string>();
  private queue: string[] = [];
  private maxConcurrent = 4;
  private pumping = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly realtime: RealtimeHub,
  ) {}

  registerRunner(kind: string, runner: TaskRunner): void {
    this.runners.set(kind, runner);
  }

  /** Mark tasks orphaned by a previous process crash/restart. */
  async recoverOnBoot(): Promise<void> {
    const orphaned = await this.db.task.updateMany({
      where: { status: { in: ['running', 'queued'] } },
      data: { status: 'failed', error: 'Interrupted by control plane restart. Retry to run again.' },
    });
    if (orphaned.count > 0) {
      console.warn(`[tasks] marked ${orphaned.count} interrupted task(s) as failed`);
    }
  }

  async create(input: {
    kind: string;
    title: string;
    data?: Record<string, unknown>;
    userId?: string;
    applicationId?: string;
    conversationId?: string;
  }): Promise<Task> {
    if (!this.runners.has(input.kind)) throw new Error(`No runner registered for task kind: ${input.kind}`);
    const task = await this.db.task.create({
      data: {
        kind: input.kind,
        title: input.title,
        status: 'queued',
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        userId: input.userId ?? null,
        applicationId: input.applicationId ?? null,
        conversationId: input.conversationId ?? null,
      },
    });
    this.realtime.publish('tasks', 'task.created', { taskId: task.id, title: task.title });
    this.queue.push(task.id);
    void this.pump();
    return task;
  }

  async retry(taskId: string): Promise<Task | null> {
    const task = await this.db.task.findUnique({ where: { id: taskId } });
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return null;
    const updated = await this.db.task.update({
      where: { id: taskId },
      data: { status: 'queued', error: null, progress: 0, result: Prisma.DbNull, startedAt: null, finishedAt: null },
    });
    this.queue.push(taskId);
    void this.pump();
    return updated;
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelRequested.add(taskId);
    // If still queued, cancel immediately.
    const idx = this.queue.indexOf(taskId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      await this.finish(taskId, 'cancelled', undefined, 'Cancelled before start');
    }
  }

  isCancelRequested(taskId: string): boolean {
    return this.cancelRequested.has(taskId);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
        const taskId = this.queue.shift()!;
        this.running.add(taskId);
        void this.run(taskId).finally(() => {
          this.running.delete(taskId);
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async run(taskId: string): Promise<void> {
    const task = await this.db.task.findUnique({ where: { id: taskId } });
    if (!task || task.status !== 'queued') return;
    const runner = this.runners.get(task.kind);
    if (!runner) {
      await this.finish(taskId, 'failed', undefined, `No runner for kind ${task.kind}`);
      return;
    }
    await this.db.task.update({ where: { id: taskId }, data: { status: 'running', startedAt: new Date() } });
    this.publishTask(taskId, 'task.started', {});

    const handle: TaskHandle = {
      id: taskId,
      log: async (message, level = 'info') => {
        await this.db.taskLog.create({ data: { taskId, level, message } }).catch(() => undefined);
        this.publishTask(taskId, 'task.log', { level, message, ts: new Date().toISOString() });
      },
      setProgress: async (progress) => {
        const p = Math.max(0, Math.min(100, Math.round(progress)));
        await this.db.task.update({ where: { id: taskId }, data: { progress: p } }).catch(() => undefined);
        this.publishTask(taskId, 'task.progress', { progress: p });
      },
      checkCancelled: () => {
        if (this.cancelRequested.has(taskId)) throw new TaskCancelledError();
      },
    };

    try {
      const result = await runner(handle, (task.data ?? {}) as Record<string, unknown>);
      await this.finish(taskId, 'completed', result);
    } catch (err) {
      if (err instanceof TaskCancelledError) {
        await this.finish(taskId, 'cancelled', undefined, 'Cancelled');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        await this.finish(taskId, 'failed', undefined, message);
      }
    } finally {
      this.cancelRequested.delete(taskId);
    }
  }

  private async finish(taskId: string, status: string, result?: unknown, error?: string): Promise<void> {
    await this.db.task
      .update({
        where: { id: taskId },
        data: {
          status,
          finishedAt: new Date(),
          error: error ?? null,
          ...(result !== undefined ? { result: result as Prisma.InputJsonValue } : {}),
          ...(status === 'completed' ? { progress: 100 } : {}),
        },
      })
      .catch(() => undefined);
    this.publishTask(taskId, 'task.finished', { status, error: error ?? null });
  }

  private publishTask(taskId: string, event: string, data: Record<string, unknown>): void {
    this.realtime.publish(`task:${taskId}`, event, { taskId, ...data });
    this.realtime.publish('tasks', event, { taskId, ...data });
  }
}
