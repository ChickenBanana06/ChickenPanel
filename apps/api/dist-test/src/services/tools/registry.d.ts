import type { z } from 'zod';
import type { Permission } from '@nexpanel/shared';
import type { AppContext } from '../../context.js';
export interface ToolInvocationContext {
    ctx: AppContext;
    conversationId: string;
    userId: string;
    /** Permissions of the conversation owner — enforced before execution. */
    permissions: Set<Permission>;
    /** Default workspace bound to the conversation, if any. */
    workspaceId: string | null;
    signal: AbortSignal;
}
export interface ToolDefinition<Args = unknown> {
    name: string;
    description: string;
    argsSchema: z.ZodType<Args, z.ZodTypeDef, unknown>;
    /** Permission required; enforced by the backend, never by the model. */
    permission: Permission;
    /** Dangerous tools require explicit user approval per call. */
    dangerous?: boolean;
    execute: (args: Args, inv: ToolInvocationContext) => Promise<unknown>;
}
export declare class ToolExecutionError extends Error {
    constructor(message: string);
}
export declare class ToolRegistry {
    private tools;
    register<A>(tool: ToolDefinition<A>): void;
    get(name: string): ToolDefinition<never> | undefined;
    /** Tool definitions visible to a user, filtered by their permissions. */
    listFor(permissions: Set<Permission>): ToolDefinition<never>[];
}
//# sourceMappingURL=registry.d.ts.map