import { CreateNodeSchema, newSecretToken, sha256Hex } from '@nexpanel/shared';
import { makeAuthHooks } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';
export async function nodeRoutes(app, ctx) {
    const { requirePermission } = makeAuthHooks(ctx);
    app.get('/', { preHandler: requirePermission('server.read') }, async () => {
        const nodes = await ctx.db.node.findMany({
            orderBy: { createdAt: 'asc' },
            include: { _count: { select: { applications: true } } },
        });
        return {
            nodes: nodes.map((n) => ({
                id: n.id, name: n.name, description: n.description, status: n.status,
                platform: n.platform, arch: n.arch, osVersion: n.osVersion,
                cpuModel: n.cpuModel, cpuCores: n.cpuCores,
                totalMemoryMb: n.totalMemoryMb, totalDiskMb: n.totalDiskMb,
                agentVersion: n.agentVersion, capabilities: n.capabilities,
                lastMetrics: n.lastMetrics, lastHeartbeatAt: n.lastHeartbeatAt,
                applicationCount: n._count.applications, connected: ctx.nodes.isOnline(n.id),
                createdAt: n.createdAt,
            })),
        };
    });
    /** Create a node and return its one-time registration token. */
    app.post('/', { preHandler: requirePermission('node.manage') }, async (req) => {
        const body = CreateNodeSchema.parse(req.body);
        const token = `npn_${newSecretToken(32)}`;
        let node;
        try {
            node = await ctx.db.node.create({
                data: { name: body.name, description: body.description ?? null, tokenHash: sha256Hex(token) },
            });
        }
        catch (err) {
            if (err.code === 'P2002')
                throw ApiError.conflict('Node name already exists');
            throw err;
        }
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'node.create',
            targetType: 'node', targetId: node.id, success: true, ip: req.ip,
        });
        // The token is shown exactly once; only its hash is stored.
        return { node: { id: node.id, name: node.name }, registrationToken: token };
    });
    app.post('/:id/rotate-token', { preHandler: requirePermission('node.manage') }, async (req) => {
        const { id } = req.params;
        const token = `npn_${newSecretToken(32)}`;
        await ctx.db.node.update({ where: { id }, data: { tokenHash: sha256Hex(token) } }).catch(() => {
            throw ApiError.notFound('Node not found');
        });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'node.rotate_token',
            targetType: 'node', targetId: id, success: true, ip: req.ip,
        });
        return { registrationToken: token };
    });
    app.delete('/:id', { preHandler: requirePermission('node.manage') }, async (req) => {
        const { id } = req.params;
        const appCount = await ctx.db.application.count({ where: { nodeId: id } });
        if (appCount > 0)
            throw ApiError.conflict('Node still has applications; delete them first');
        await ctx.db.node.delete({ where: { id } }).catch(() => {
            throw ApiError.notFound('Node not found');
        });
        await writeAudit(ctx.db, {
            actor: 'user', userId: req.authedUser.id, action: 'node.delete',
            targetType: 'node', targetId: id, success: true, ip: req.ip,
        });
        return { ok: true };
    });
    app.get('/:id', { preHandler: requirePermission('server.read') }, async (req) => {
        const { id } = req.params;
        const node = await ctx.db.node.findUnique({
            where: { id },
            include: { applications: { select: { id: true, name: true, type: true, status: true, ports: true } } },
        });
        if (!node)
            throw ApiError.notFound('Node not found');
        const { tokenHash: _t, ...rest } = node;
        return { node: { ...rest, connected: ctx.nodes.isOnline(id) } };
    });
}
/** Agent WebSocket endpoint — token auth happens inside the protocol hello. */
export async function agentWsRoute(app, ctx) {
    app.get('/ws', { websocket: true }, (socket) => {
        ctx.nodes.handleConnection(socket);
    });
}
//# sourceMappingURL=nodes.js.map