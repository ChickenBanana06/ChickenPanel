import { AppRuntimeSpecSchema, ProvisionStepSchema, } from '@nexpanel/shared';
import { ApiError } from '../lib/errors.js';
import { PortAllocator } from './port-allocator.js';
/**
 * Orchestrates the application lifecycle: creation is compiled by the
 * registered extension into an AppRuntimeSpec + provisioning steps, executed
 * on the target node as a persistent task.
 */
export class AppService {
    ctx;
    ports;
    constructor(ctx) {
        this.ctx = ctx;
        this.ports = new PortAllocator(ctx.db, ctx.nodes);
        this.registerTaskRunners();
    }
    registerTaskRunners() {
        this.ctx.tasks.registerRunner('app.provision', async (handle, data) => {
            const appId = data.appId;
            const app = await this.ctx.db.application.findUnique({ where: { id: appId } });
            if (!app)
                throw new Error('Application no longer exists');
            const spec = AppRuntimeSpecSchema.parse(data.spec);
            const steps = ProvisionStepSchema.array().parse(data.steps ?? []);
            await handle.log(`Provisioning ${app.name} on node ${app.nodeId}`);
            await this.setStatus(appId, 'provisioning');
            try {
                await this.ctx.nodes.command(app.nodeId, { op: 'app.provision', spec, steps }, {
                    timeoutMs: 30 * 60 * 1000,
                    onStream: (channel, chunk) => {
                        void handle.log(chunk.trimEnd(), channel === 'stderr' ? 'warn' : 'info');
                    },
                });
                await this.setStatus(appId, 'stopped');
                await handle.log('Provisioning complete');
                const autoStart = Boolean(app.config?.autoStart);
                if (autoStart) {
                    await handle.log('Auto-starting application');
                    await this.start(appId);
                }
                return { appId };
            }
            catch (err) {
                await this.setStatus(appId, 'errored');
                throw err;
            }
        });
        this.ctx.tasks.registerRunner('app.delete', async (handle, data) => {
            const appId = data.appId;
            const nodeId = data.nodeId;
            const removeFiles = data.removeFiles !== false;
            await handle.log('Removing application from node');
            if (this.ctx.nodes.isOnline(nodeId)) {
                await this.ctx.nodes.command(nodeId, { op: 'app.delete', appId, removeFiles }, { timeoutMs: 120000 });
            }
            else {
                await handle.log('Node offline — removing control plane record only', 'warn');
            }
            await this.ctx.db.application.delete({ where: { id: appId } }).catch(() => undefined);
            this.ctx.realtime.publish('apps', 'app.deleted', { appId });
            return { appId };
        });
    }
    async create(input) {
        const ext = this.ctx.extensions.get(input.type);
        if (!ext)
            throw ApiError.badRequest(`Unknown application type: ${input.type}`);
        const node = await this.ctx.db.node.findUnique({ where: { id: input.nodeId } });
        if (!node)
            throw ApiError.notFound('Node not found');
        if (!this.ctx.nodes.isOnline(node.id))
            throw ApiError.unavailable('Node is offline — cannot provision');
        const parsedConfig = ext.configSchema.safeParse(input.config);
        if (!parsedConfig.success) {
            throw ApiError.badRequest(`Invalid ${input.type} config: ${parsedConfig.error.issues[0]?.message ?? 'invalid'}`);
        }
        const plan = await ext.buildCreation({
            name: input.name,
            nodeId: input.nodeId,
            node,
            env: input.env ?? {},
            limits: input.limits ?? {},
            restartPolicy: input.restartPolicy ?? 'on-crash',
            config: parsedConfig.data,
        }, {
            db: this.ctx.db,
            allocatePorts: (nodeId, count, preferred) => this.ports.allocate(nodeId, count, preferred),
        });
        let app;
        try {
            app = await this.ctx.db.application.create({
                data: {
                    name: input.name,
                    type: input.type,
                    status: 'creating',
                    nodeId: input.nodeId,
                    createdById: input.userId ?? null,
                    ports: plan.ports,
                    env: plan.env,
                    config: plan.config,
                    limits: (input.limits ?? {}),
                    restartPolicy: input.restartPolicy ?? 'on-crash',
                },
            });
        }
        catch (err) {
            if (err.code === 'P2002') {
                throw ApiError.conflict('An application with this name already exists on the node');
            }
            throw err;
        }
        // The extension built the spec before the app row existed; fix up the id.
        const spec = { ...plan.spec, appId: app.id };
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
    async allocateExtraPort(appId) {
        const app = await this.get(appId);
        if (app.ports.length >= 16)
            throw ApiError.badRequest('Port limit reached (16 per application)');
        const [port] = await this.ports.allocate(app.nodeId, 1);
        if (!port)
            throw ApiError.conflict('No free port available');
        const envVar = `PORT_${app.ports.length + 1}`;
        const env = { ...(app.env ?? {}), [envVar]: String(port) };
        await this.ctx.db.application.update({
            where: { id: appId },
            data: { ports: [...app.ports, port], env: env },
        });
        this.ctx.realtime.publish('apps', 'app.updated', { appId });
        return { port, envVar };
    }
    async get(appId) {
        const app = await this.ctx.db.application.findUnique({ where: { id: appId } });
        if (!app)
            throw ApiError.notFound('Application not found');
        return app;
    }
    buildSpec(app) {
        const ext = this.ctx.extensions.require(app.type);
        return { ...ext.buildRuntimeSpec(app), appId: app.id };
    }
    async start(appId) {
        const app = await this.get(appId);
        // Sync the spec first so config changes take effect on restart.
        await this.ctx.nodes.command(app.nodeId, { op: 'app.sync', spec: this.buildSpec(app) });
        await this.ctx.nodes.command(app.nodeId, { op: 'app.start', appId }, { timeoutMs: 120000 });
    }
    async stop(appId) {
        const app = await this.get(appId);
        await this.ctx.nodes.command(app.nodeId, { op: 'app.stop', appId }, { timeoutMs: 180000 });
    }
    async restart(appId) {
        const app = await this.get(appId);
        await this.ctx.nodes.command(app.nodeId, { op: 'app.stop', appId }, { timeoutMs: 180000 });
        await this.ctx.nodes.command(app.nodeId, { op: 'app.sync', spec: this.buildSpec(app) });
        await this.ctx.nodes.command(app.nodeId, { op: 'app.start', appId }, { timeoutMs: 120000 });
    }
    async kill(appId) {
        const app = await this.get(appId);
        await this.ctx.nodes.command(app.nodeId, { op: 'app.kill', appId });
    }
    async sendConsole(appId, line) {
        const app = await this.get(appId);
        await this.ctx.nodes.command(app.nodeId, { op: 'app.input', appId, line });
    }
    async tailLogs(appId, lines) {
        const app = await this.get(appId);
        return this.ctx.nodes.command(app.nodeId, { op: 'app.logs.tail', appId, lines });
    }
    async requestDelete(appId, userId) {
        const app = await this.get(appId);
        await this.setStatus(appId, 'deleting');
        const task = await this.ctx.tasks.create({
            kind: 'app.delete',
            title: `Delete ${app.name}`,
            data: { appId: app.id, nodeId: app.nodeId, removeFiles: true },
            userId,
        });
        return task.id;
    }
    async setStatus(appId, status) {
        await this.ctx.db.application.updateMany({ where: { id: appId }, data: { status } });
        this.ctx.realtime.publish(`app:${appId}`, 'status', { status, exitCode: null });
        this.ctx.realtime.publish('apps', 'app.status', { appId, status });
    }
}
//# sourceMappingURL=app-service.js.map