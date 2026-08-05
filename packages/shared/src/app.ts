import { z } from 'zod';

/** Built-in application type identifiers. Extensions may register more. */
export const BUILTIN_APP_TYPES = [
  'minecraft',
  'node',
  'python',
  'website',
  'postgres',
  'mysql',
  'redis',
  'discord-bot',
  'custom',
] as const;

export const AppStatusSchema = z.enum([
  'creating',
  'provisioning',
  'stopped',
  'starting',
  'running',
  'stopping',
  'crashed',
  'errored',
  'deleting',
]);
export type AppStatus = z.infer<typeof AppStatusSchema>;

export const RestartPolicySchema = z.enum(['never', 'on-crash', 'always']);
export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

/** How the agent stops a process gracefully before escalating to a hard kill. */
export const StopMethodSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signal'), signal: z.enum(['SIGTERM', 'SIGINT']).default('SIGTERM') }),
  z.object({ type: z.literal('stdin'), command: z.string().min(1).max(200) }),
]);
export type StopMethod = z.infer<typeof StopMethodSchema>;

export const ResourceLimitsSchema = z.object({
  cpuPercent: z.number().int().min(1).max(6400).nullable().default(null),
  memoryMb: z.number().int().min(64).max(1048576).nullable().default(null),
  diskMb: z.number().int().min(64).max(67108864).nullable().default(null),
});
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;

/**
 * Runtime spec shipped to the Node Agent. This is everything the agent needs
 * to run an application instance; control-plane concepts (users, extensions)
 * never leak into it.
 */
export const AppRuntimeSpecSchema = z.object({
  appId: z.string(),
  name: z.string(),
  type: z.string(),
  /** argv form — executed without a shell to prevent injection */
  startCommand: z.array(z.string().min(1)).min(1),
  stopMethod: StopMethodSchema,
  /** seconds to wait after graceful stop before hard-killing */
  stopGraceSeconds: z.number().int().min(1).max(600).default(30),
  env: z.record(z.string()).default({}),
  restartPolicy: RestartPolicySchema.default('on-crash'),
  limits: ResourceLimitsSchema.default({ cpuPercent: null, memoryMb: null, diskMb: null }),
  ports: z.array(z.number().int().min(1).max(65535)).default([]),
});
export type AppRuntimeSpec = z.infer<typeof AppRuntimeSpecSchema>;

/** Generic provisioning steps compiled by extensions, executed by the agent. */
export const ProvisionStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('mkdir'), path: z.string() }),
  z.object({ op: z.literal('write'), path: z.string(), content: z.string(), base64: z.boolean().default(false) }),
  z.object({
    op: z.literal('download'),
    url: z.string().url(),
    dest: z.string(),
    sha256: z.string().optional(),
  }),
  z.object({ op: z.literal('extract'), archive: z.string(), dest: z.string() }),
  z.object({
    op: z.literal('exec'),
    command: z.array(z.string().min(1)).min(1),
    cwd: z.string().default('.'),
    timeoutMs: z.number().int().min(1000).max(1800000).default(300000),
  }),
]);
export type ProvisionStep = z.infer<typeof ProvisionStepSchema>;

export const AppMetricsSchema = z.object({
  cpuPercent: z.number(),
  memoryMb: z.number(),
  diskMb: z.number().nullable(),
  uptimeSeconds: z.number(),
  pid: z.number().nullable(),
});
export type AppMetrics = z.infer<typeof AppMetricsSchema>;
