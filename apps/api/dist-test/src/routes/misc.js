import { makeAuthHooks, resolveSession } from '../plugins/auth.js';
import { ApiError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
export async function taskRoutes(app, ctx) {
    const { requirePermission, requireAuth } = makeAuthHooks(ctx);
    app.get('/', { preHandler: requireAuth }, async (req) => {
        const { status, limit } = req.query;
        const tasks = await ctx.db.task.findMany({
            where: status ? { status } : undefined,
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(limit ?? 50) || 50, 200),
        });
        return { tasks };
    });
    app.get('/:id', { preHandler: requireAuth }, async (req) => {
        const { id } = req.params;
        const task = await ctx.db.task.findUnique({ where: { id } });
        if (!task)
            throw ApiError.notFound('Task not found');
        const logs = await ctx.db.taskLog.findMany({ where: { taskId: id }, orderBy: { ts: 'asc' }, take: 500 });
        return { task, logs };
    });
    app.post('/:id/cancel', { preHandler: requireAuth }, async (req) => {
        const { id } = req.params;
        await ctx.tasks.cancel(id);
        return { ok: true };
    });
    app.post('/:id/retry', { preHandler: requirePermission('server.create') }, async (req) => {
        const { id } = req.params;
        const task = await ctx.tasks.retry(id);
        if (!task)
            throw ApiError.badRequest('Task is not retryable');
        return { task: { id: task.id, status: task.status } };
    });
}
export function backupRoutes(backups) {
    return async function (app, ctx) {
        const { requirePermission } = makeAuthHooks(ctx);
        app.get('/app/:appId', { preHandler: requirePermission('server.read') }, async (req) => {
            const { appId } = req.params;
            const rows = await ctx.db.backup.findMany({ where: { applicationId: appId }, orderBy: { createdAt: 'desc' } });
            return {
                backups: rows.map((b) => ({
                    id: b.id, name: b.name, status: b.status,
                    sizeBytes: b.sizeBytes === null ? null : Number(b.sizeBytes),
                    error: b.error, createdAt: b.createdAt, completedAt: b.completedAt,
                })),
            };
        });
        app.post('/app/:appId', { preHandler: requirePermission('backups.manage') }, async (req) => {
            const { appId } = req.params;
            const { name } = req.body;
            const result = await backups.create(appId, name?.slice(0, 100) || `backup-${new Date().toISOString().slice(0, 16)}`, req.authedUser.id);
            return { backupId: result.backup.id, taskId: result.taskId };
        });
        app.post('/:backupId/restore', { preHandler: requirePermission('backups.manage') }, async (req) => {
            const { backupId } = req.params;
            const result = await backups.restore(backupId, req.authedUser.id);
            await writeAudit(ctx.db, {
                actor: 'user', userId: req.authedUser.id, action: 'backup.restore',
                targetType: 'backup', targetId: backupId, success: true, ip: req.ip,
            });
            return result;
        });
        app.delete('/:backupId', { preHandler: requirePermission('backups.manage') }, async (req) => {
            const { backupId } = req.params;
            const backup = await ctx.db.backup.findUnique({ where: { id: backupId }, include: { application: true } });
            if (!backup)
                throw ApiError.notFound('Backup not found');
            if (ctx.nodes.isOnline(backup.application.nodeId)) {
                await ctx.nodes
                    .command(backup.application.nodeId, { op: 'backup.delete', appId: backup.applicationId, backupId })
                    .catch(() => undefined);
            }
            await ctx.db.backup.delete({ where: { id: backupId } });
            return { ok: true };
        });
    };
}
export async function auditRoutes(app, ctx) {
    const { requirePermission } = makeAuthHooks(ctx);
    app.get('/', { preHandler: requirePermission('audit.read') }, async (req) => {
        const { limit, action } = req.query;
        const logs = await ctx.db.auditLog.findMany({
            where: action ? { action: { startsWith: action } } : undefined,
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(limit ?? 100) || 100, 500),
            include: { user: { select: { username: true } } },
        });
        return { logs };
    });
}
export async function userRoutes(app, ctx) {
    const { requirePermission } = makeAuthHooks(ctx);
    /** Admin-created accounts — public registration is disabled after setup. */
    app.post('/', { preHandler: requirePermission('users.manage') }, async (req) => {
        const body = req.body;
        if (!body.username || !/^[a-zA-Z0-9_.-]{3,32}$/.test(body.username)) {
            throw ApiError.badRequest('Username must be 3-32 characters (letters, numbers, ., _, -)');
        }
        if (!body.password || body.password.length < 8 || body.password.length > 256) {
            throw ApiError.badRequest('Password must be at least 8 characters');
        }
        const role = body.role ?? 'USER';
        if (!['ADMIN', 'USER', 'VIEWER'].includes(role))
            throw ApiError.badRequest('Invalid role');
        const email = body.email?.trim()
            ? body.email.trim().toLowerCase()
            : `${body.username.toLowerCase()}@users.nexpanel.local`;
        const { hashPassword } = await import('../lib/passwords.js');
        try {
            const user = await ctx.db.user.create({
                data: { username: body.username, email, passwordHash: await hashPassword(body.password), role: role },
            });
            await writeAudit(ctx.db, {
                actor: 'user', userId: req.authedUser.id, action: 'user.create',
                targetType: 'user', targetId: user.id, args: { username: body.username, role }, success: true, ip: req.ip,
            });
            return { user: { id: user.id, username: user.username, role: user.role } };
        }
        catch (err) {
            if (err.code === 'P2002')
                throw ApiError.conflict('Username or email already in use');
            throw err;
        }
    });
    app.get('/', { preHandler: requirePermission('users.manage') }, async () => {
        const users = await ctx.db.user.findMany({
            select: {
                id: true, username: true, email: true, role: true,
                grantedPermissions: true, revokedPermissions: true, createdAt: true,
            },
        });
        return { users };
    });
    app.patch('/:id', { preHandler: requirePermission('users.manage') }, async (req) => {
        const { id } = req.params;
        const body = req.body;
        if (body.role && !['ADMIN', 'USER', 'VIEWER'].includes(body.role))
            throw ApiError.badRequest('Invalid role');
        let passwordHash;
        if (body.password !== undefined) {
            if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 256) {
                throw ApiError.badRequest('Password must be at least 8 characters');
            }
            const { hashPassword } = await import('../lib/passwords.js');
            passwordHash = await hashPassword(body.password);
        }
        const user = await ctx.db.user.update({
            where: { id },
            data: {
                ...(body.role ? { role: body.role } : {}),
                ...(body.grantedPermissions ? { grantedPermissions: body.grantedPermissions } : {}),
                ...(body.revokedPermissions ? { revokedPermissions: body.revokedPermissions } : {}),
                ...(passwordHash ? { passwordHash } : {}),
            },
        });
        if (passwordHash) {
            // Password reset by an admin signs the target user out everywhere.
            await ctx.db.session.deleteMany({ where: { userId: id } });
        }
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'user.update',
            targetType: 'user', targetId: id, args: body, success: true, ip: req.ip,
        });
        return { user: { id: user.id, role: user.role } };
    });
    app.delete('/:id', { preHandler: requirePermission('users.manage') }, async (req) => {
        const { id } = req.params;
        if (id === req.authedUser.id)
            throw ApiError.badRequest('Cannot delete your own account');
        await ctx.db.user.delete({ where: { id } });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'user.delete',
            targetType: 'user', targetId: id, success: true, ip: req.ip,
        });
        return { ok: true };
    });
}
/** Authenticated UI realtime WebSocket. */
export async function realtimeWsRoute(app, ctx) {
    app.get('/ws', { websocket: true }, async (socket, req) => {
        const token = req.cookies[ctx.config.cookieName];
        const user = await resolveSession(ctx, token);
        if (!user) {
            socket.close(4401, 'unauthorized');
            return;
        }
        ctx.realtime.register(socket, user.id);
    });
}
//# sourceMappingURL=misc.js.map