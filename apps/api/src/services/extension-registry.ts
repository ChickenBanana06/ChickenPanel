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
  command: <T = unknown>(cmd: unknown, opts?: { timeoutMs?: number }) => Promise<T>;
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

export class ExtensionRegistry {
  private extensions = new Map<string, ApplicationExtension>();

  register(ext: ApplicationExtension): void {
    if (this.extensions.has(ext.type)) {
      throw new Error(`Extension type already registered: ${ext.type}`);
    }
    this.extensions.set(ext.type, ext);
  }

  get(type: string): ApplicationExtension | undefined {
    return this.extensions.get(type);
  }

  require(type: string): ApplicationExtension {
    const ext = this.extensions.get(type);
    if (!ext) throw new Error(`Unknown application type: ${type}`);
    return ext;
  }

  list(): { type: string; displayName: string; description: string }[] {
    return [...this.extensions.values()].map((e) => ({
      type: e.type,
      displayName: e.displayName,
      description: e.description,
    }));
  }
}
