import { CreateApplicationSchema, UpdateApplicationSchema, FileWriteSchema, safeRelativePath } from '@nexpanel/shared';
import { makeAuthHooks } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';
function requirePath(input) {
    const p = safeRelativePath(String(input ?? ''));
    if (p === null)
        throw ApiError.badRequest('Invalid path');
    return p;
}
export async function appRoutes(app, ctx) {
    const { requirePermission } = makeAuthHooks(ctx);
    app.get('/', { preHandler: requirePermission('server.read') }, async () => {
        const apps = await ctx.db.application.findMany({
            orderBy: { createdAt: 'desc' },
            include: { node: { select: { id: true, name: true, status: true } } },
        });
        return {
            applications: apps.map((a) => ({
                id: a.id, name: a.name, type: a.type, status: a.status, node: a.node,
                ports: a.ports, restartPolicy: a.restartPolicy, limits: a.limits,
                lastMetrics: a.lastMetrics, createdAt: a.createdAt, updatedAt: a.updatedAt,
            })),
        };
    });
    app.get('/types', { preHandler: requirePermission('server.read') }, async () => {
        return { types: ctx.extensions.list() };
    });
    app.get('/types/:type/catalog', { preHandler: requirePermission('server.read') }, async (req) => {
        const { type } = req.params;
        const ext = ctx.extensions.get(type);
        if (!ext)
            throw ApiError.notFound('Unknown application type');
        return { catalog: ext.getCatalog ? await ext.getCatalog() : null };
    });
    app.post('/', { preHandler: requirePermission('server.create') }, async (req) => {
        const body = CreateApplicationSchema.parse(req.body);
        const { app: created, taskId } = await ctx.apps.create({
            name: body.name,
            type: body.type,
            nodeId: body.nodeId,
            env: body.env,
            limits: body.limits,
            restartPolicy: body.restartPolicy,
            config: body.config,
            userId: req.authedUser.id,
        });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'app.create',
            targetType: 'application', targetId: created.id,
            args: { name: body.name, type: body.type, nodeId: body.nodeId }, success: true, ip: req.ip,
        });
        return { application: { id: created.id, name: created.name, ports: created.ports }, taskId };
    });
    app.get('/:id', { preHandler: requirePermission('server.read') }, async (req) => {
        const { id } = req.params;
        const a = await ctx.db.application.findUnique({
            where: { id },
            include: { node: { select: { id: true, name: true, status: true, platform: true } } },
        });
        if (!a)
            throw ApiError.notFound('Application not found');
        return {
            application: {
                id: a.id, name: a.name, type: a.type, status: a.status, node: a.node,
                ports: a.ports, env: a.env, config: a.config, limits: a.limits,
                restartPolicy: a.restartPolicy, lastMetrics: a.lastMetrics, lastExitCode: a.lastExitCode,
                createdAt: a.createdAt, updatedAt: a.updatedAt,
            },
        };
    });
    app.patch('/:id', { preHandler: requirePermission('server.create') }, async (req) => {
        const { id } = req.params;
        const body = UpdateApplicationSchema.parse(req.body);
        const existing = await ctx.apps.get(id);
        const mergedConfig = body.config
            ? { ...existing.config, ...body.config }
            : undefined;
        const updated = await ctx.db.application.update({
            where: { id },
            data: {
                ...(body.name ? { name: body.name } : {}),
                ...(body.env ? { env: body.env } : {}),
                ...(body.limits ? { limits: body.limits } : {}),
                ...(body.restartPolicy ? { restartPolicy: body.restartPolicy } : {}),
                ...(mergedConfig ? { config: mergedConfig } : {}),
            },
        });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'app.update',
            targetType: 'application', targetId: id, args: body, success: true, ip: req.ip,
        });
        return { application: { id: updated.id } };
    });
    for (const [action, permission] of [
        ['start', 'server.start'],
        ['stop', 'server.stop'],
        ['restart', 'server.start'],
        ['kill', 'server.stop'],
    ]) {
        app.post(`/:id/${action}`, { preHandler: requirePermission(permission) }, async (req) => {
            const { id } = req.params;
            try {
                await ctx.apps[action](id);
                await writeAudit(ctx.db, {
                    actor: 'user', userId: req.authedUser.id, action: `app.${action}`,
                    targetType: 'application', targetId: id, success: true, ip: req.ip,
                });
                return { ok: true };
            }
            catch (err) {
                await writeAudit(ctx.db, {
                    actor: 'user', userId: req.authedUser.id, action: `app.${action}`,
                    targetType: 'application', targetId: id, success: false,
                    error: err instanceof Error ? err.message : String(err), ip: req.ip,
                });
                throw err;
            }
        });
    }
    app.post('/:id/ports/allocate', { preHandler: requirePermission('server.create') }, async (req) => {
        const { id } = req.params;
        const result = await ctx.apps.allocateExtraPort(id);
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'app.port.allocate',
            targetType: 'application', targetId: id, args: result, success: true, ip: req.ip,
        });
        return result;
    });
    app.delete('/:id', { preHandler: requirePermission('server.delete') }, async (req) => {
        const { id } = req.params;
        const taskId = await ctx.apps.requestDelete(id, req.authedUser.id);
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'app.delete',
            targetType: 'application', targetId: id, success: true, ip: req.ip,
        });
        return { taskId };
    });
    app.post('/:id/console', { preHandler: requirePermission('server.console') }, async (req) => {
        const { id } = req.params;
        const { command } = req.body;
        if (!command || typeof command !== 'string' || command.length > 2000) {
            throw ApiError.badRequest('command required');
        }
        await ctx.apps.sendConsole(id, command);
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'app.console',
            targetType: 'application', targetId: id, args: { command }, success: true, ip: req.ip,
        });
        return { ok: true };
    });
    app.get('/:id/logs', { preHandler: requirePermission('server.console') }, async (req) => {
        const { id } = req.params;
        const { lines } = req.query;
        return ctx.apps.tailLogs(id, Math.min(Number(lines ?? 200) || 200, 2000));
    });
    /* ---------------- File manager ---------------- */
    app.get('/:id/files', { preHandler: requirePermission('files.read') }, async (req) => {
        const { id } = req.params;
        const { path } = req.query;
        const a = await ctx.apps.get(id);
        return ctx.nodes.command(a.nodeId, {
            op: 'fs.list',
            appId: id,
            path: path ? requirePath(path) : '.',
        });
    });
    app.get('/:id/files/content', { preHandler: requirePermission('files.read') }, async (req) => {
        const { id } = req.params;
        const { path } = req.query;
        const a = await ctx.apps.get(id);
        return ctx.nodes.command(a.nodeId, {
            op: 'fs.read',
            appId: id,
            path: requirePath(path),
            maxBytes: 2097152,
        });
    });
    app.put('/:id/files/content', { preHandler: requirePermission('files.write') }, async (req) => {
        const { id } = req.params;
        const body = FileWriteSchema.parse(req.body);
        const a = await ctx.apps.get(id);
        await ctx.nodes.command(a.nodeId, {
            op: 'fs.write',
            appId: id,
            path: requirePath(body.path),
            content: body.content,
            base64: body.base64,
        });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'files.write',
            targetType: 'application', targetId: id, args: { path: body.path }, success: true, ip: req.ip,
        });
        return { ok: true };
    });
    app.post('/:id/files/mkdir', { preHandler: requirePermission('files.write') }, async (req) => {
        const { id } = req.params;
        const { path } = req.body;
        const a = await ctx.apps.get(id);
        await ctx.nodes.command(a.nodeId, { op: 'fs.mkdir', appId: id, path: requirePath(path) });
        return { ok: true };
    });
    app.post('/:id/files/rename', { preHandler: requirePermission('files.write') }, async (req) => {
        const { id } = req.params;
        const { from, to } = req.body;
        const a = await ctx.apps.get(id);
        await ctx.nodes.command(a.nodeId, { op: 'fs.rename', appId: id, from: requirePath(from), to: requirePath(to) });
        return { ok: true };
    });
    app.post('/:id/files/delete', { preHandler: requirePermission('files.write') }, async (req) => {
        const { id } = req.params;
        const { path } = req.body;
        const a = await ctx.apps.get(id);
        await ctx.nodes.command(a.nodeId, { op: 'fs.delete', appId: id, path: requirePath(path) });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'files.delete',
            targetType: 'application', targetId: id, args: { path }, success: true, ip: req.ip,
        });
        return { ok: true };
    });
    app.get('/:id/files/search', { preHandler: requirePermission('files.read') }, async (req) => {
        const { id } = req.params;
        const { query, path } = req.query;
        if (!query)
            throw ApiError.badRequest('query required');
        const a = await ctx.apps.get(id);
        return ctx.nodes.command(a.nodeId, {
            op: 'fs.search',
            appId: id,
            path: path ? requirePath(path) : '.',
            query: String(query).slice(0, 500),
            maxResults: 100,
        });
    });
}
//# sourceMappingURL=apps.js.map