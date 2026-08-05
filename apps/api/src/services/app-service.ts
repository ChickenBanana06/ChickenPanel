import type { Application, Prisma } from '@nexpanel/database';
import {
  AppRuntimeSpecSchema,
  ProvisionStepSchema,
  type AppRuntimeSpec,
  type ResourceLimits,
  type RestartPolicy,
} from '@nexpanel/shared';
import type { AppContext } from '../context.js';
import { ApiError } from '../lib/errors.js';
import { PortAllocator } from './port-allocator.js';

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
export class AppService {
  private ports: PortAllocator;

  constructor(private readonly ctx: Omit<AppContext, 'ai' | 'apps'>) {
    this.ports = new PortAllocator(ctx.db, ctx.nodes);
    this.registerTaskRunners();
  }

  private registerTaskRunners(): void {
    this.ctx.tasks.registerRunner('app.provision', async (handle, data) => {
      const appId = data.appId as string;
      const app = await this.ctx.db.application.findUnique({ where: { id: appId } });
      if (!app) throw new Error('Application no longer exists');
      const spec = AppRuntimeSpecSchema.parse(data.spec);
      const steps = ProvisionStepSchema.array().parse(data.steps ?? []);

      await handle.log(`Provisioning ${app.name} on node ${app.nodeId}`);
      await this.setStatus(appId, 'provisioning');
      try {
        await this.ctx.nodes.command(
          app.nodeId,
          { op: 'app.provision', spec, steps },
          {
            timeoutMs: 30 * 60 * 1000,
            onStream: (channel, chunk) => {
              void handle.log(chunk.trimEnd(), channel === 'stderr' ? 'warn' : 'info');
            },
          },
        );
        await this.setStatus(appId, 'stopped');
        await handle.log('Provisioning complete');
        const autoStart = Boolean((app.config as Record<string, unknown>)?.autoStart);
        if (autoStart) {
          await handle.log('Auto-starting application');
          await this.start(appId);
        }
        return { appId };
      } catch (err) {
        await this.setStatus(appId, 'errored');
        throw err;
      }
    });

    // Best-effort node-side cleanup after the control-plane record is already
    // gone. Stops the process and removes files; if the node is offline the
    // files are left behind (harmless orphans) rather than blocking deletion.
    this.ctx.tasks.registerRunner('app.cleanup', async (handle, data) => {
      const appId = data.appId as string;
      const nodeId = data.nodeId as string;
      if (this.ctx.nodes.isOnline(nodeId)) {
        await handle.log('Removing application files from node');
        await this.ctx.nodes.command(nodeId, { op: 'app.delete', appId, removeFiles: true }, { timeoutMs: 120000 });
        await handle.log('Cleanup complete');
      } else {
        await handle.log('Node offline — files will remain until it reconnects', 'warn');
      }
      return { appId };
    });
  }

  async create(input: CreateAppInput): Promise<{ app: Application; taskId: string }> {
    const ext = this.ctx.extensions.get(input.type);
    if (!ext) throw ApiError.badRequest(`Unknown application type: ${input.type}`);
    const node = await this.ctx.db.node.findUnique({ where: { id: input.nodeId } });
    if (!node) throw ApiError.notFound('Node not found');
    if (!this.ctx.nodes.isOnline(node.id)) throw ApiError.unavailable('Node is offline — cannot provision');

    const parsedConfig = ext.configSchema.safeParse(input.config);
    if (!parsedConfig.success) {
      throw ApiError.badRequest(`Invalid ${input.type} config: ${parsedConfig.error.issues[0]?.message ?? 'invalid'}`);
    }

    const plan = await ext.buildCreation(
      {
        name: input.name,
        nodeId: input.nodeId,
        node,
        env: input.env ?? {},
        limits: input.limits ?? {},
        restartPolicy: input.restartPolicy ?? 'on-crash',
        config: parsedConfig.data as Record<string, unknown>,
      },
      {
        db: this.ctx.db,
        allocatePorts: (nodeId, count, preferred) => this.ports.allocate(nodeId, count, preferred),
      },
    );

    let app: Application;
    try {
      app = await this.ctx.db.application.create({
        data: {
          name: input.name,
          type: input.type,
          status: 'creating',
          nodeId: input.nodeId,
          createdById: input.userId ?? null,
          ports: plan.ports,
          env: plan.env as Prisma.InputJsonValue,
          config: plan.config as Prisma.InputJsonValue,
          limits: (input.limits ?? {}) as Prisma.InputJsonValue,
          restartPolicy: input.restartPolicy ?? 'on-crash',
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw ApiError.conflict('An application with this name already exists on the node');
      }
      throw err;
    }

    // The extension built the spec before the app row existed; fix up the id.
    const spec: AppRuntimeSpec = { ...plan.spec, appId: app.id };

    const task = await this.ctx.tasks.create({
      kind: 'app.provision',
      title: `Provision ${app.name}`,
      data: { appId: app.id, spec, steps: plan.steps },
      userId: input.userId,
      applicationId: app.id,
    });

    this.ctx.realtime.publish('apps', 'app.created', { appId: app.id });
    return { app, taskId: task.id };
  }

  /**
   * Allocate one additional port for an application. The port is appended to
   * the app's port list and exposed as PORT_<n> in its environment (applied
   * on the next restart).
   */
  async allocateExtraPort(appId: string, preferredPort?: number): Promise<{ port: number; envVar: string }> {
    const app = await this.get(appId);
    if (app.ports.length >= 16) throw ApiError.badRequest('Port limit reached (16 per application)');
    
    let port: number;
    if (preferredPort !== undefined) {
      if (preferredPort < 1 || preferredPort > 65535) throw ApiError.badRequest('Invalid port number');
      const [allocated] = await this.ports.allocate(app.nodeId, 1, [preferredPort]);
      if (allocated !== preferredPort) {
        throw ApiError.conflict(`Port ${preferredPort} is already in use or unavailable on this node`);
      }
      port = allocated;
    } else {
      const [allocated] = await this.ports.allocate(app.nodeId, 1);
      if (!allocated) throw ApiError.conflict('No free port available');
      port = allocated;
    }
    
    const envVar = `PORT_${app.ports.length + 1}`;
    const env = { ...((app.env as Record<string, string>) ?? {}), [envVar]: String(port) };
    await this.ctx.db.application.update({
      where: { id: appId },
      data: { ports: [...app.ports, port], env: env as Prisma.InputJsonValue },
    });
    this.ctx.realtime.publish('apps', 'app.updated', { appId });
    return { port, envVar };
  }

  /**
   * Delete an allocated port from an application, shifting remaining PORT_<n> vars.
   */
  async deletePort(appId: string, port: number): Promise<void> {
    const app = await this.get(appId);
    if (!app.ports.includes(port)) throw ApiError.notFound('Port not found on this application');
    if (app.ports[0] === port) throw ApiError.badRequest('Cannot delete the primary application port');
    
    const updatedPorts = app.ports.filter((p) => p !== port);
    const env = { ...((app.env as Record<string, string>) ?? {}) };
    
    // Clean up all PORT_<n> environment variables
    for (const key of Object.keys(env)) {
      if (/^PORT_\d+$/.test(key)) {
        delete env[key];
      }
    }
    
    // Re-add remaining ports sequentially in environment variables
    updatedPorts.forEach((p, idx) => {
      env[`PORT_${idx + 1}`] = String(p);
    });
    
    await this.ctx.db.application.update({
      where: { id: appId },
      data: { ports: updatedPorts, env: env as Prisma.InputJsonValue },
    });
    this.ctx.realtime.publish('apps', 'app.updated', { appId });
  }

  async get(appId: string): Promise<Application> {
    const app = await this.ctx.db.application.findUnique({ where: { id: appId } });
    if (!app) throw ApiError.notFound('Application not found');
    return app;
  }

  private buildSpec(app: Application): AppRuntimeSpec {
    const ext = this.ctx.extensions.require(app.type);
    return { ...ext.buildRuntimeSpec(app), appId: app.id };
  }

  async start(appId: string): Promise<void> {
    const app = await this.get(appId);
    // Sync the spec first so config changes take effect on restart.
    await this.ctx.nodes.command(app.nodeId, { op: 'app.sync', spec: this.buildSpec(app) });
    await this.ctx.nodes.command(app.nodeId, { op: 'app.start', appId }, { timeoutMs: 120000 });
  }

  async stop(appId: string): Promise<void> {
    const app = await this.get(appId);
    await this.ctx.nodes.command(app.nodeId, { op: 'app.stop', appId }, { timeoutMs: 180000 });
  }

  async restart(appId: string): Promise<void> {
    const app = await this.get(appId);
    await this.ctx.nodes.command(app.nodeId, { op: 'app.stop', appId }, { timeoutMs: 180000 });
    await this.ctx.nodes.command(app.nodeId, { op: 'app.sync', spec: this.buildSpec(app) });
    await this.ctx.nodes.command(app.nodeId, { op: 'app.start', appId }, { timeoutMs: 120000 });
  }

  async kill(appId: string): Promise<void> {
    const app = await this.get(appId);
    await this.ctx.nodes.command(app.nodeId, { op: 'app.kill', appId });
  }

  async sendConsole(appId: string, line: string): Promise<void> {
    const app = await this.get(appId);
    await this.ctx.nodes.command(app.nodeId, { op: 'app.input', appId, line });
  }

  async tailLogs(appId: string, lines: number): Promise<{ lines: { stream: string; line: string }[] }> {
    const app = await this.get(appId);
    return this.ctx.nodes.command(app.nodeId, { op: 'app.logs.tail', appId, lines });
  }

  async requestDelete(appId: string, userId?: string): Promise<string> {
    const app = await this.get(appId);
    // Remove the control-plane record immediately so the application vanishes
    // from the UI right away. Cascades to its backups; existing tasks keep
    // their history (applicationId is set null).
    await this.ctx.db.application.delete({ where: { id: appId } });
    this.ctx.realtime.publish('apps', 'app.deleted', { appId });
    // Clean up the process and files on the node in the background.
    const task = await this.ctx.tasks.create({
      kind: 'app.cleanup',
      title: `Clean up ${app.name}`,
      data: { appId: app.id, nodeId: app.nodeId },
      userId,
    });
    return task.id;
  }

  private async setStatus(appId: string, status: string): Promise<void> {
    await this.ctx.db.application.updateMany({ where: { id: appId }, data: { status } });
    this.ctx.realtime.publish(`app:${appId}`, 'status', { status, exitCode: null });
    this.ctx.realtime.publish('apps', 'app.status', { appId, status });
  }
}
