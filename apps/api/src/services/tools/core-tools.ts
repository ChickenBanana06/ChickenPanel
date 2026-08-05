import { z } from 'zod';
import { safeRelativePath, type FileEntry } from '@nexpanel/shared';
import type { AppContext } from '../../context.js';
import { ToolExecutionError, ToolRegistry, type ToolInvocationContext } from './registry.js';
import type { BackupService } from '../backup-service.js';

const ScopeSchema = z.object({
  kind: z.enum(['app', 'workspace']).describe('Whether the path is inside an application directory or an AI workspace'),
  id: z.string().describe('The application id or workspace id'),
});

async function resolveScope(
  inv: ToolInvocationContext,
  scope: { kind: 'app' | 'workspace'; id: string },
): Promise<{ nodeId: string; agentScope: { kind: 'app' | 'workspace'; id: string } }> {
  const { ctx } = inv;
  if (scope.kind === 'app') {
    const app = await ctx.db.application.findUnique({ where: { id: scope.id } });
    if (!app) throw new ToolExecutionError(`Application not found: ${scope.id}`);
    return { nodeId: app.nodeId, agentScope: scope };
  }
  const ws = await ctx.db.workspace.findUnique({ where: { id: scope.id } });
  if (!ws) throw new ToolExecutionError(`Workspace not found: ${scope.id}`);
  if (ws.userId !== inv.userId) throw new ToolExecutionError('Workspace belongs to another user');
  return { nodeId: ws.nodeId, agentScope: scope };
}

function checkPath(p: string): string {
  const safe = safeRelativePath(p);
  if (safe === null && p !== '.' && p !== '') {
    throw new ToolExecutionError(`Unsafe or invalid path: ${p}`);
  }
  return safe ?? '.';
}

export function registerCoreTools(registry: ToolRegistry, backups: BackupService): void {
  /* ---------------- Filesystem ---------------- */

  registry.register({
    name: 'list_directory',
    description: 'List files and directories at a path inside an application directory or workspace.',
    permission: 'files.read',
    argsSchema: z.object({ scope: ScopeSchema, path: z.string().default('.') }),
    execute: async (args, inv) => {
      const { nodeId, agentScope } = await resolveScope(inv, args.scope);
      return inv.ctx.nodes.command<{ entries: FileEntry[] }>(nodeId, {
        op: 'fs.list',
        appId: scopeId(agentScope),
        path: checkPath(args.path),
      });
    },
  });

  registry.register({
    name: 'read_file',
    description: 'Read a text file. Returns at most 1MB of content.',
    permission: 'files.read',
    argsSchema: z.object({ scope: ScopeSchema, path: z.string() }),
    execute: async (args, inv) => {
      const { nodeId, agentScope } = await resolveScope(inv, args.scope);
      return inv.ctx.nodes.command(nodeId, {
        op: 'fs.read',
        appId: scopeId(agentScope),
        path: checkPath(args.path),
        maxBytes: 1048576,
      });
    },
  });

  registry.register({
    name: 'write_file',
    description: 'Create or overwrite a text file with the given content. Creates parent directories automatically.',
    permission: 'files.write',
    argsSchema: z.object({ scope: ScopeSchema, path: z.string(), content: z.string().max(2097152) }),
    execute: async (args, inv) => {
      const { nodeId, agentScope } = await resolveScope(inv, args.scope);
      return inv.ctx.nodes.command(nodeId, {
        op: 'fs.write',
        appId: scopeId(agentScope),
        path: checkPath(args.path),
        content: args.content,
        base64: false,
      });
    },
  });

  registry.register({
    name: 'edit_file',
    description:
      'Edit a text file by replacing an exact string. The old string must appear exactly once unless replace_all is true.',
    permission: 'files.write',
    argsSchema: z.object({
      scope: ScopeSchema,
      path: z.string(),
      old_string: z.string().min(1),
      new_string: z.string(),
      replace_all: z.boolean().default(false),
    }),
    execute: async (args, inv) => {
      const { nodeId, agentScope } = await resolveScope(inv, args.scope);
      const path = checkPath(args.path);
      const file = await inv.ctx.nodes.command<{ content: string; truncated: boolean }>(nodeId, {
        op: 'fs.read',
        appId: scopeId(agentScope),
        path,
        maxBytes: 2097152,
      });
      if (file.truncated) throw new ToolExecutionError('File too large to edit in place');
      const occurrences = file.content.split(args.old_string).length - 1;
      if (occurrences === 0) throw new ToolExecutionError('old_string not found in file');
      if (occurrences > 1 && !args.replace_all) {
        throw new ToolExecutionError(`old_string appears ${occurrences} times; pass replace_all or disambiguate`);
      }
      const updated = args.replace_all
        ? file.content.split(args.old_string).join(args.new_string)
        : file.content.replace(args.old_string, args.new_string);
      await inv.ctx.nodes.command(nodeId, {
        op: 'fs.write',
        appId: scopeId(agentScope),
        path,
        content: updated,
        base64: false,
      });
      return { replaced: args.replace_all ? occurrences : 1 };
    },
  });

  registry.register({
    name: 'search_files',
    description: 'Search for a text substring across files under a path. Returns matching files with line numbers.',
    permission: 'files.read',
    argsSchema: z.object({
      scope: ScopeSchema,
      path: z.string().default('.'),
      query: z.string().min(1).max(500),
    }),
    execute: async (args, inv) => {
      const { nodeId, agentScope } = await resolveScope(inv, args.scope);
      return inv.ctx.nodes.command(nodeId, {
        op: 'fs.search',
        appId: scopeId(agentScope),
        path: checkPath(args.path),
        query: args.query,
        maxResults: 100,
      });
    },
  });

  /* ---------------- Terminal ---------------- */

  registry.register({
    name: 'run_command',
    description:
      'Run a shell command inside an application directory or workspace (for builds, installs, tests). ' +
      'Output is truncated at 1MB and the command is killed after the timeout.',
    permission: 'terminal.execute',
    dangerous: true,
    argsSchema: z.object({
      scope: ScopeSchema,
      command: z.string().min(1).max(4000).describe('Shell command line to execute'),
      cwd: z.string().default('.'),
      timeout_seconds: z.number().int().min(1).max(1800).default(300),
    }),
    execute: async (args, inv) => {
      const { nodeId, agentScope } = await resolveScope(inv, args.scope);
      let output = '';
      const result = await inv.ctx.nodes.command<{ exitCode: number | null; timedOut: boolean; truncated: boolean }>(
        nodeId,
        {
          op: 'proc.exec',
          scope: agentScope,
          command: [args.command],
          shell: true,
          cwd: checkPath(args.cwd),
          env: {},
          timeoutMs: args.timeout_seconds * 1000,
          maxOutputBytes: 1048576,
        },
        {
          timeoutMs: args.timeout_seconds * 1000 + 15000,
          onStream: (channel, chunk) => {
            if (channel !== 'progress') output += chunk;
          },
        },
      );
      return { exitCode: result.exitCode, timedOut: result.timedOut, truncated: result.truncated, output: output.slice(-1048576) };
    },
  });

  /* ---------------- Infrastructure ---------------- */

  registry.register({
    name: 'list_nodes',
    description: 'List all machines (nodes) managed by the panel, including status and resources.',
    permission: 'server.read',
    argsSchema: z.object({}),
    execute: async (_args, inv) => {
      const nodes = await inv.ctx.db.node.findMany({
        select: {
          id: true, name: true, status: true, platform: true, arch: true, cpuModel: true,
          cpuCores: true, totalMemoryMb: true, totalDiskMb: true, agentVersion: true,
          lastHeartbeatAt: true, lastMetrics: true, capabilities: true,
        },
      });
      return { nodes };
    },
  });

  registry.register({
    name: 'list_applications',
    description: 'List all applications (servers, bots, sites…) with type, status, node and ports.',
    permission: 'server.read',
    argsSchema: z.object({ type: z.string().optional() }),
    execute: async (args, inv) => {
      const apps = await inv.ctx.db.application.findMany({
        where: args.type ? { type: args.type } : undefined,
        select: {
          id: true, name: true, type: true, status: true, nodeId: true, ports: true,
          restartPolicy: true, createdAt: true, lastMetrics: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return { applications: apps };
    },
  });

  registry.register({
    name: 'get_application',
    description: 'Get full details of one application: status, config, ports, resource usage, node.',
    permission: 'server.read',
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      const app = await inv.ctx.db.application.findUnique({
        where: { id: args.application_id },
        include: { node: { select: { id: true, name: true, status: true, platform: true } } },
      });
      if (!app) throw new ToolExecutionError('Application not found');
      const { env: _env, ...rest } = app as Record<string, unknown>;
      return { application: rest, envKeys: Object.keys((app.env as Record<string, string>) ?? {}) };
    },
  });

  registry.register({
    name: 'list_application_types',
    description: 'List the application types this panel can create (minecraft, node, python, website, discord-bot…).',
    permission: 'server.read',
    argsSchema: z.object({}),
    execute: async (_args, inv) => ({ types: inv.ctx.extensions.list() }),
  });

  registry.register({
    name: 'get_type_catalog',
    description:
      'Get creation catalog for an application type (e.g. available Minecraft versions and server software). ' +
      'Call this before create_application for types that need a version.',
    permission: 'server.read',
    argsSchema: z.object({ type: z.string() }),
    execute: async (args, inv) => {
      const ext = inv.ctx.extensions.get(args.type);
      if (!ext) throw new ToolExecutionError(`Unknown type: ${args.type}`);
      if (!ext.getCatalog) return { catalog: null };
      return { catalog: await ext.getCatalog() };
    },
  });

  registry.register({
    name: 'create_application',
    description:
      'Create a new application on a node. config is type-specific — call get_type_catalog first. ' +
      'Returns the application id and a provisioning task id; poll get_task until it completes.',
    permission: 'server.create',
    argsSchema: z.object({
      name: z.string().min(1).max(64),
      type: z.string(),
      node_id: z.string(),
      config: z.record(z.unknown()).default({}),
      env: z.record(z.string()).default({}),
      memory_mb: z.number().int().min(64).optional(),
    }),
    execute: async (args, inv) => {
      const { app, taskId } = await inv.ctx.apps.create({
        name: args.name,
        type: args.type,
        nodeId: args.node_id,
        config: args.config,
        env: args.env,
        limits: args.memory_mb ? { memoryMb: args.memory_mb } : {},
        userId: inv.userId,
      });
      return { applicationId: app.id, provisionTaskId: taskId, ports: app.ports };
    },
  });

  registry.register({
    name: 'start_application',
    description: 'Start an application.',
    permission: 'server.start',
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      await inv.ctx.apps.start(args.application_id);
      return { ok: true };
    },
  });

  registry.register({
    name: 'stop_application',
    description: 'Gracefully stop an application.',
    permission: 'server.stop',
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      await inv.ctx.apps.stop(args.application_id);
      return { ok: true };
    },
  });

  registry.register({
    name: 'restart_application',
    description: 'Restart an application (stop, sync config, start).',
    permission: 'server.start',
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      await inv.ctx.apps.restart(args.application_id);
      return { ok: true };
    },
  });

  registry.register({
    name: 'delete_application',
    description: 'Permanently delete an application and its files. Irreversible.',
    permission: 'server.delete',
    dangerous: true,
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      const taskId = await inv.ctx.apps.requestDelete(args.application_id, inv.userId);
      return { deleteTaskId: taskId };
    },
  });

  registry.register({
    name: 'read_console',
    description: 'Read the most recent console/log lines of an application.',
    permission: 'server.console',
    argsSchema: z.object({ application_id: z.string(), lines: z.number().int().min(1).max(1000).default(100) }),
    execute: async (args, inv) => inv.ctx.apps.tailLogs(args.application_id, args.lines),
  });

  registry.register({
    name: 'send_console_command',
    description: 'Send a command line to the stdin/console of a running application (e.g. a Minecraft server command).',
    permission: 'server.console',
    argsSchema: z.object({ application_id: z.string(), command: z.string().min(1).max(2000) }),
    execute: async (args, inv) => {
      await inv.ctx.apps.sendConsole(args.application_id, args.command);
      return { ok: true };
    },
  });

  registry.register({
    name: 'app_action',
    description:
      'Run a type-specific action on an application (e.g. minecraft install_plugin). ' +
      'Use get_application_actions to discover available actions and their arguments.',
    permission: 'server.read',
    argsSchema: z.object({
      application_id: z.string(),
      action: z.string(),
      args: z.record(z.unknown()).default({}),
    }),
    execute: async (args, inv) => {
      const app = await inv.ctx.db.application.findUnique({ where: { id: args.application_id } });
      if (!app) throw new ToolExecutionError('Application not found');
      const ext = inv.ctx.extensions.get(app.type);
      const action = ext?.actions?.find((a) => a.id === args.action);
      if (!action) throw new ToolExecutionError(`Unknown action ${args.action} for type ${app.type}`);
      if (!inv.permissions.has(action.permission as never)) {
        throw new ToolExecutionError(`Missing permission: ${action.permission}`);
      }
      const parsed = action.argsSchema.safeParse(args.args);
      if (!parsed.success) throw new ToolExecutionError(`Invalid args: ${parsed.error.issues[0]?.message}`);
      return action.run(app, parsed.data, {
        db: inv.ctx.db,
        command: (cmd, opts) => inv.ctx.nodes.command(app.nodeId, cmd as never, opts),
      });
    },
  });

  registry.register({
    name: 'get_application_actions',
    description: 'List type-specific actions available for an application.',
    permission: 'server.read',
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      const app = await inv.ctx.db.application.findUnique({ where: { id: args.application_id } });
      if (!app) throw new ToolExecutionError('Application not found');
      const ext = inv.ctx.extensions.get(app.type);
      return {
        actions: (ext?.actions ?? []).map((a) => ({
          id: a.id,
          displayName: a.displayName,
          permission: a.permission,
        })),
      };
    },
  });

  /* ---------------- Backups ---------------- */

  registry.register({
    name: 'create_backup',
    description: 'Create a backup of an application. Returns a task id to poll.',
    permission: 'backups.manage',
    argsSchema: z.object({ application_id: z.string(), name: z.string().min(1).max(100) }),
    execute: async (args, inv) => {
      const { backup, taskId } = await backups.create(args.application_id, args.name, inv.userId);
      return { backupId: backup.id, taskId };
    },
  });

  registry.register({
    name: 'restore_backup',
    description: 'Restore a backup OVER the current application files. Destructive.',
    permission: 'backups.manage',
    dangerous: true,
    argsSchema: z.object({ backup_id: z.string() }),
    execute: async (args, inv) => backups.restore(args.backup_id, inv.userId),
  });

  registry.register({
    name: 'list_backups',
    description: 'List backups of an application.',
    permission: 'server.read',
    argsSchema: z.object({ application_id: z.string() }),
    execute: async (args, inv) => {
      const rows = await inv.ctx.db.backup.findMany({
        where: { applicationId: args.application_id },
        orderBy: { createdAt: 'desc' },
      });
      return {
        backups: rows.map((b) => ({
          id: b.id, name: b.name, status: b.status,
          sizeBytes: b.sizeBytes === null ? null : Number(b.sizeBytes), createdAt: b.createdAt,
        })),
      };
    },
  });

  /* ---------------- Workspaces & tasks ---------------- */

  registry.register({
    name: 'create_workspace',
    description:
      'Create a coding workspace on a node for building projects (plugins, bots, websites). ' +
      'Returns a workspace id usable as a scope for file and command tools.',
    permission: 'deployment.create',
    argsSchema: z.object({ name: z.string().min(1).max(64), node_id: z.string() }),
    execute: async (args, inv) => {
      const node = await inv.ctx.db.node.findUnique({ where: { id: args.node_id } });
      if (!node) throw new ToolExecutionError('Node not found');
      const ws = await inv.ctx.db.workspace.create({
        data: { name: args.name, userId: inv.userId, nodeId: args.node_id },
      });
      await inv.ctx.nodes.command(args.node_id, { op: 'workspace.create', workspaceId: ws.id });
      // Bind this conversation to the workspace it created.
      await inv.ctx.db.aIConversation.updateMany({
        where: { id: inv.conversationId },
        data: { workspaceId: ws.id },
      });
      return { workspaceId: ws.id };
    },
  });

  registry.register({
    name: 'list_workspaces',
    description: 'List your coding workspaces.',
    permission: 'server.read',
    argsSchema: z.object({}),
    execute: async (_args, inv) => {
      const workspaces = await inv.ctx.db.workspace.findMany({ where: { userId: inv.userId } });
      return { workspaces };
    },
  });

  registry.register({
    name: 'get_task',
    description: 'Get status, progress and recent logs of a background task.',
    permission: 'server.read',
    argsSchema: z.object({ task_id: z.string() }),
    execute: async (args, inv) => {
      const task = await inv.ctx.db.task.findUnique({ where: { id: args.task_id } });
      if (!task) throw new ToolExecutionError('Task not found');
      const logs = await inv.ctx.db.taskLog.findMany({
        where: { taskId: task.id },
        orderBy: { ts: 'desc' },
        take: 50,
      });
      return {
        task: {
          id: task.id, kind: task.kind, title: task.title, status: task.status,
          progress: task.progress, error: task.error, result: task.result,
        },
        logs: logs.reverse().map((l) => `[${l.level}] ${l.message}`),
      };
    },
  });
}

function scopeId(scope: { kind: 'app' | 'workspace'; id: string }): string {
  // The agent's fs.* commands accept either an app id or "ws:<workspaceId>".
  return scope.kind === 'app' ? scope.id : `ws:${scope.id}`;
}
