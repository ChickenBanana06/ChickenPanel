import type { z } from 'zod';
import type { PrismaClient, Application, Node } from '@nexpanel/database';
import type { AppRuntimeSpec, ProvisionStep, ResourceLimits, RestartPolicy } from '@nexpanel/shared';
export interface ExtensionContext {
    db: PrismaClient;
    /** Allocate `count` free ports on the node, verified against the agent. */
    allocatePorts: (nodeId: string, count: number, preferred?: number[]) => Promise<number[]>;
}
export interface CreationInput {
    name: string;
    nodeId: string;
    node: Node;
    env: Record<string, string>;
    limits: Partial<ResourceLimits>;
    restartPolicy: RestartPolicy;
    /** Extension-validated config object */
    config: Record<string, unknown>;
}
export interface CreationPlan {
    spec: AppRuntimeSpec;
    steps: ProvisionStep[];
    ports: number[];
    /** Final config persisted on the application row */
    config: Record<string, unknown>;
    env: Record<string, string>;
}
export interface ExtensionAction {
    id: string;
    displayName: string;
    /** Permission enforced by the backend before the action runs. */
    permission: string;
    dangerous?: boolean;
    argsSchema: z.ZodTypeAny;
    run: (app: Application, args: unknown, helpers: ExtensionActionHelpers) => Promise<unknown>;
}
export interface ExtensionActionHelpers {
    command: <T = unknown>(cmd: unknown, opts?: {
        timeoutMs?: number;
    }) => Promise<T>;
    db: PrismaClient;
}
/**
 * An application extension teaches the platform how to create and manage one
 * application type. Extensions compile everything down to generic agent
 * primitives (AppRuntimeSpec + ProvisionSteps), so the Node Agent never
 * contains type-specific logic.
 */
export interface ApplicationExtension {
    type: string;
    displayName: string;
    description: string;
    /** zod schema for the `config` object accepted at creation time. */
    configSchema: z.ZodTypeAny;
    /** Optional catalog data for the creation UI (versions, software choices…). */
    getCatalog?: () => Promise<unknown>;
    buildCreation(input: CreationInput, ctx: ExtensionContext): Promise<CreationPlan>;
    /** Rebuild the runtime spec from a stored application (start/sync). */
    buildRuntimeSpec(app: Application): AppRuntimeSpec;
    actions?: ExtensionAction[];
}
export declare class ExtensionRegistry {
    private extensions;
    register(ext: ApplicationExtension): void;
    get(type: string): ApplicationExtension | undefined;
    require(type: string): ApplicationExtension;
    list(): {
        type: string;
        displayName: string;
        description: string;
    }[];
}
//# sourceMappingURL=extension-registry.d.ts.map