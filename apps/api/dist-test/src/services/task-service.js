import { Prisma } from '@nexpanel/database';
export class TaskCancelledError extends Error {
    constructor() {
        super('Task cancelled');
        this.name = 'TaskCancelledError';
    }
}
/**
 * Persistent task system. Tasks are stored in PostgreSQL, run in-process with
 * bounded concurrency, and survive browser refreshes (they are fully
 * server-side). On boot, tasks left in `running` state from a previous
 * process are marked failed with a retry hint.
 */
export class TaskService {
    db;
    realtime;
    runners = new Map();
    cancelRequested = new Set();
    running = new Set();
    queue = [];
    maxConcurrent = 4;
    pumping = false;
    constructor(db, realtime) {
        this.db = db;
        this.realtime = realtime;
    }
    registerRunner(kind, runner) {
        this.runners.set(kind, runner);
    }
    /** Mark tasks orphaned by a previous process crash/restart. */
    async recoverOnBoot() {
        const orphaned = await this.db.task.updateMany({
            where: { status: { in: ['running', 'queued'] } },
            data: { status: 'failed', error: 'Interrupted by control plane restart. Retry to run again.' },
        });
        if (orphaned.count > 0) {
            console.warn(`[tasks] marked ${orphaned.count} interrupted task(s) as failed`);
        }
    }
    async create(input) {
        if (!this.runners.has(input.kind))
            throw new Error(`No runner registered for task kind: ${input.kind}`);
        const task = await this.db.task.create({
            data: {
                kind: input.kind,
                title: input.title,
                status: 'queued',
                data: (input.data ?? {}),
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
    async retry(taskId) {
        const task = await this.db.task.findUnique({ where: { id: taskId } });
        if (!task || (task.status !== 'failed' && task.status !== 'cancelled'))
            return null;
        const updated = await this.db.task.update({
            where: { id: taskId },
            data: { status: 'queued', error: null, progress: 0, result: Prisma.DbNull, startedAt: null, finishedAt: null },
        });
        this.queue.push(taskId);
        void this.pump();
        return updated;
    }
    async cancel(taskId) {
        this.cancelRequested.add(taskId);
        // If still queued, cancel immediately.
        const idx = this.queue.indexOf(taskId);
        if (idx >= 0) {
            this.queue.splice(idx, 1);
            await this.finish(taskId, 'cancelled', undefined, 'Cancelled before start');
        }
    }
    isCancelRequested(taskId) {
        return this.cancelRequested.has(taskId);
    }
    async pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
                const taskId = this.queue.shift();
                this.running.add(taskId);
                void this.run(taskId).finally(() => {
                    this.running.delete(taskId);
                    void this.pump();
                });
            }
        }
        finally {
            this.pumping = false;
        }
    }
    async run(taskId) {
        const task = await this.db.task.findUnique({ where: { id: taskId } });
        if (!task || task.status !== 'queued')
            return;
        const runner = this.runners.get(task.kind);
        if (!runner) {
            await this.finish(taskId, 'failed', undefined, `No runner for kind ${task.kind}`);
            return;
        }
        await this.db.task.update({ where: { id: taskId }, data: { status: 'running', startedAt: new Date() } });
        this.publishTask(taskId, 'task.started', {});
        const handle = {
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
                if (this.cancelRequested.has(taskId))
                    throw new TaskCancelledError();
            },
        };
        try {
            const result = await runner(handle, (task.data ?? {}));
            await this.finish(taskId, 'completed', result);
        }
        catch (err) {
            if (err instanceof TaskCancelledError) {
                await this.finish(taskId, 'cancelled', undefined, 'Cancelled');
            }
            else {
                const message = err instanceof Error ? err.message : String(err);
                await this.finish(taskId, 'failed', undefined, message);
            }
        }
        finally {
            this.cancelRequested.delete(taskId);
        }
    }
    async finish(taskId, status, result, error) {
        await this.db.task
            .update({
            where: { id: taskId },
            data: {
                status,
                finishedAt: new Date(),
                error: error ?? null,
                ...(result !== undefined ? { result: result } : {}),
                ...(status === 'completed' ? { progress: 100 } : {}),
            },
        })
            .catch(() => undefined);
        this.publishTask(taskId, 'task.finished', { status, error: error ?? null });
    }
    publishTask(taskId, event, data) {
        this.realtime.publish(`task:${taskId}`, event, { taskId, ...data });
        this.realtime.publish('tasks', event, { taskId, ...data });
    }
}
//# sourceMappingURL=task-service.js.map