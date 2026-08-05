import type { PrismaClient, Task } from '@nexpanel/database';
import type { RealtimeHub } from './realtime.js';
export interface TaskHandle {
    id: string;
    log: (message: string, level?: 'info' | 'warn' | 'error') => Promise<void>;
    setProgress: (progress: number) => Promise<void>;
    /** Throws TaskCancelledError if the task has been cancelled. */
    checkCancelled: () => void;
}
export declare class TaskCancelledError extends Error {
    constructor();
}
export type TaskRunner = (handle: TaskHandle, data: Record<string, unknown>) => Promise<unknown>;
/**
 * Persistent task system. Tasks are stored in PostgreSQL, run in-process with
 * bounded concurrency, and survive browser refreshes (they are fully
 * server-side). On boot, tasks left in `running` state from a previous
 * process are marked failed with a retry hint.
 */
export declare class TaskService {
    private readonly db;
    private readonly realtime;
    private runners;
    private cancelRequested;
    private running;
    private queue;
    private maxConcurrent;
    private pumping;
    constructor(db: PrismaClient, realtime: RealtimeHub);
    registerRunner(kind: string, runner: TaskRunner): void;
    /** Mark tasks orphaned by a previous process crash/restart. */
    recoverOnBoot(): Promise<void>;
    create(input: {
        kind: string;
        title: string;
        data?: Record<string, unknown>;
        userId?: string;
        applicationId?: string;
        conversationId?: string;
    }): Promise<Task>;
    retry(taskId: string): Promise<Task | null>;
    cancel(taskId: string): Promise<void>;
    isCancelRequested(taskId: string): boolean;
    private pump;
    private run;
    private finish;
    private publishTask;
}
//# sourceMappingURL=task-service.d.ts.map