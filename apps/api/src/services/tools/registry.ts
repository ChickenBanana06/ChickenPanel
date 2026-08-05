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

export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<never>>();

  register<A>(tool: ToolDefinition<A>): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as unknown as ToolDefinition<never>);
  }

  get(name: string): ToolDefinition<never> | undefined {
    return this.tools.get(name);
  }

  /** Tool definitions visible to a user, filtered by their permissions. */
  listFor(permissions: Set<Permission>): ToolDefinition<never>[] {
    return [...this.tools.values()].filter((t) => permissions.has(t.permission));
  }
}
