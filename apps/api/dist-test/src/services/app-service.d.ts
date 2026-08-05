import type { Application } from '@nexpanel/database';
import { type ResourceLimits, type RestartPolicy } from '@nexpanel/shared';
import type { AppContext } from '../context.js';
export interface CreateAppInput {
    name: string;
    type: string;
    nodeId: string;
    env?: Record<string, string>;
    limits?: Partial<ResourceLimits>;
    restartPolicy?: RestartPolicy;
    config: Record<string, unknown>;
    userId?: string;
}
/**
 * Orchestrates the application lifecycle: creation is compiled by the
 * registered extension into an AppRuntimeSpec + provisioning steps, executed
 * on the target node as a persistent task.
 */
export declare class AppService {
    private readonly ctx;
    private ports;
    constructor(ctx: Omit<AppContext, 'ai' | 'apps'>);
    private registerTaskRunners;
    create(input: CreateAppInput): Promise<{
        app: Application;
        taskId: string;
    }>;
    /**
     * Allocate one additional port for an application. The port is appended to
     * the app's port list and exposed as PORT_<n> in its environment (applied
     * on the next restart).
     */
    allocateExtraPort(appId: string): Promise<{
        port: number;
        envVar: string;
    }>;
    get(appId: string): Promise<Application>;
    private buildSpec;
    start(appId: string): Promise<void>;
    stop(appId: string): Promise<void>;
    restart(appId: string): Promise<void>;
    kill(appId: string): Promise<void>;
    sendConsole(appId: string, line: string): Promise<void>;
    tailLogs(appId: string, lines: number): Promise<{
        lines: {
            stream: string;
            line: string;
        }[];
    }>;
    requestDelete(appId: string, userId?: string): Promise<string>;
    private setStatus;
}
//# sourceMappingURL=app-service.d.ts.map