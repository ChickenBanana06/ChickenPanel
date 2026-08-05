import { z } from 'zod';
import { AppRuntimeSpecSchema, ProvisionStepSchema, AppStatusSchema, AppMetricsSchema } from './app.js';

export const AGENT_PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ */
/* System information reported by agents                               */
/* ------------------------------------------------------------------ */

export const SystemInfoSchema = z.object({
  hostname: z.string(),
  platform: z.enum(['linux', 'win32', 'darwin']),
  arch: z.string(),
  osVersion: z.string(),
  cpuModel: z.string(),
  cpuCores: z.number().int(),
  totalMemoryMb: z.number(),
  totalDiskMb: z.number().nullable(),
  agentVersion: z.string(),
  capabilities: z.object({
    docker: z.boolean(),
    java: z.string().nullable(),
    node: z.string().nullable(),
    python: z.string().nullable(),
    git: z.boolean(),
  }),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const NodeMetricsSchema = z.object({
  cpuPercent: z.number(),
  memoryUsedMb: z.number(),
  memoryTotalMb: z.number(),
  diskUsedMb: z.number().nullable(),
  diskTotalMb: z.number().nullable(),
  loadAvg: z.array(z.number()).nullable(),
});
export type NodeMetrics = z.infer<typeof NodeMetricsSchema>;

/* ------------------------------------------------------------------ */
/* File manager entries                                                */
/* ------------------------------------------------------------------ */

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  sizeBytes: z.number(),
  modifiedAt: z.string(),
  mode: z.string().nullable(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

/* ------------------------------------------------------------------ */
/* Commands: control plane -> agent                                    */
/* ------------------------------------------------------------------ */

const path = z.string().max(4096);

export const AgentCommandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('sys.info') }),
  z.object({ op: z.literal('sys.ports.check'), ports: z.array(z.number().int().min(1).max(65535)).min(1).max(64) }),

  z.object({
    op: z.literal('app.provision'),
    spec: AppRuntimeSpecSchema,
    steps: z.array(ProvisionStepSchema),
  }),
  z.object({ op: z.literal('app.sync'), spec: AppRuntimeSpecSchema }),
  z.object({ op: z.literal('app.start'), appId: z.string() }),
  z.object({ op: z.literal('app.stop'), appId: z.string() }),
  z.object({ op: z.literal('app.kill'), appId: z.string() }),
  z.object({ op: z.literal('app.delete'), appId: z.string(), removeFiles: z.boolean().default(true) }),
  z.object({ op: z.literal('app.status'), appId: z.string() }),
  z.object({ op: z.literal('app.input'), appId: z.string(), line: z.string().max(4000) }),
  z.object({ op: z.literal('app.logs.tail'), appId: z.string(), lines: z.number().int().min(1).max(2000).default(200) }),

  z.object({ op: z.literal('fs.list'), appId: z.string(), path }),
  z.object({ op: z.literal('fs.read'), appId: z.string(), path, maxBytes: z.number().int().max(10485760).default(1048576) }),
  z.object({ op: z.literal('fs.write'), appId: z.string(), path, content: z.string(), base64: z.boolean().default(false) }),
  z.object({ op: z.literal('fs.delete'), appId: z.string(), path }),
  z.object({ op: z.literal('fs.rename'), appId: z.string(), from: path, to: path }),
  z.object({ op: z.literal('fs.mkdir'), appId: z.string(), path }),
  z.object({ op: z.literal('fs.stat'), appId: z.string(), path }),
  z.object({
    op: z.literal('fs.search'),
    appId: z.string(),
    path,
    query: z.string().min(1).max(500),
    maxResults: z.number().int().max(500).default(100),
  }),
  z.object({ op: z.literal('fs.download'), appId: z.string(), url: z.string().url(), dest: path }),

  z.object({
    op: z.literal('proc.exec'),
    /** Workspace scope: an app id or a workspace id — resolved by the agent to a sandbox root. */
    scope: z.object({ kind: z.enum(['app', 'workspace']), id: z.string() }),
    command: z.array(z.string().min(1)).min(1),
    cwd: path.default('.'),
    env: z.record(z.string()).default({}),
    timeoutMs: z.number().int().min(1000).max(3600000).default(120000),
    maxOutputBytes: z.number().int().max(10485760).default(1048576),
    /** When true, run through the platform shell (needed for builds using shell features). */
    shell: z.boolean().default(false),
  }),
  z.object({ op: z.literal('proc.cancel'), execId: z.string() }),

  z.object({ op: z.literal('backup.create'), appId: z.string(), backupId: z.string() }),
  z.object({ op: z.literal('backup.restore'), appId: z.string(), backupId: z.string() }),
  z.object({ op: z.literal('backup.delete'), appId: z.string(), backupId: z.string() }),

  z.object({ op: z.literal('workspace.create'), workspaceId: z.string() }),
  z.object({ op: z.literal('workspace.delete'), workspaceId: z.string() }),
]);
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

/* ------------------------------------------------------------------ */
/* Envelope messages                                                   */
/* ------------------------------------------------------------------ */

/** Agent -> control plane */
export const AgentMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    protocol: z.number().int(),
    token: z.string(),
    system: SystemInfoSchema,
  }),
  z.object({ t: z.literal('heartbeat'), metrics: NodeMetricsSchema, apps: z.record(AppStatusSchema) }),
  z.object({ t: z.literal('result'), reqId: z.string(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() }),
  z.object({
    t: z.literal('stream'),
    reqId: z.string(),
    channel: z.enum(['stdout', 'stderr', 'progress']),
    chunk: z.string(),
  }),
  z.object({
    t: z.literal('app.event'),
    appId: z.string(),
    event: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('status'), status: AppStatusSchema, exitCode: z.number().nullable().optional() }),
      z.object({ kind: z.literal('log'), stream: z.enum(['stdout', 'stderr']), line: z.string() }),
      z.object({ kind: z.literal('metrics'), metrics: AppMetricsSchema }),
    ]),
  }),
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/** Control plane -> agent */
export const ControlMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello_ack'), nodeId: z.string(), heartbeatIntervalMs: z.number().int() }),
  z.object({ t: z.literal('hello_reject'), reason: z.string() }),
  z.object({ t: z.literal('cmd'), reqId: z.string(), cmd: AgentCommandSchema }),
]);
export type ControlMessage = z.infer<typeof ControlMessageSchema>;

export function parseAgentMessage(raw: string): AgentMessage | null {
  try {
    return AgentMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseControlMessage(raw: string): ControlMessage | null {
  try {
    return ControlMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
