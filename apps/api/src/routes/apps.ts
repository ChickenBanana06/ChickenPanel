import type { FastifyInstance } from 'fastify';
import { CreateApplicationSchema, UpdateApplicationSchema, FileWriteSchema, safeRelativePath } from '@nexpanel/shared';
import type { Prisma } from '@nexpanel/database';
import type { AppContext } from '../context.js';
import { makeAuthHooks } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';

function requirePath(input: unknown): string {
  const p = safeRelativePath(String(input ?? ''));
  if (p === null) throw ApiError.badRequest('Invalid path');
  return p;
}

export async function appRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
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
    const { type } = req.params as { type: string };
    const ext = ctx.extensions.get(type);
    if (!ext) throw ApiError.notFound('Unknown application type');
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
      userId: req.authedUser!.id,
    });
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'app.create',
      targetType: 'application', targetId: created.id,
      args: { name: body.name, type: body.type, nodeId: body.nodeId }, success: true, ip: req.ip,
    });
    return { application: { id: created.id, name: created.name, ports: created.ports }, taskId };
  });

  app.get('/:id', { preHandler: requirePermission('server.read') }, async (req) => {
    const { id } = req.params as { id: string };
    const a = await ctx.db.application.findUnique({
      where: { id },
      include: { node: { select: { id: true, name: true, status: true, platform: true } } },
    });
    if (!a) throw ApiError.notFound('Application not found');
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
    const { id } = req.params as { id: string };
    const body = UpdateApplicationSchema.parse(req.body);
    const existing = await ctx.apps.get(id);
    const mergedConfig = body.config
      ? { ...(existing.config as Record<string, unknown>), ...body.config }
      : undefined;
    const updated = await ctx.db.application.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.env ? { env: body.env as Prisma.InputJsonValue } : {}),
        ...(body.limits ? { limits: body.limits as Prisma.InputJsonValue } : {}),
        ...(body.restartPolicy ? { restartPolicy: body.restartPolicy } : {}),
        ...(mergedConfig ? { config: mergedConfig as Prisma.InputJsonValue } : {}),
      },
    });
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'app.update',
      targetType: 'application', targetId: id, args: body, success: true, ip: req.ip,
    });
    return { application: { id: updated.id } };
  });

  for (const [action, permission] of [
    ['start', 'server.start'],
    ['stop', 'server.stop'],
    ['restart', 'server.start'],
    ['kill', 'server.stop'],
  ] as const) {
    app.post(`/:id/${action}`, { preHandler: requirePermission(permission) }, async (req) => {
      const { id } = req.params as { id: string };
      try {
        await ctx.apps[action](id);
        await writeAudit(ctx.db, {
          actor: 'user', userId: req.authedUser!.id, action: `app.${action}`,
          targetType: 'application', targetId: id, success: true, ip: req.ip,
        });
        return { ok: true };
      } catch (err) {
        await writeAudit(ctx.db, {
          actor: 'user', userId: req.authedUser!.id, action: `app.${action}`,
          targetType: 'application', targetId: id, success: false,
          error: err instanceof Error ? err.message : String(err), ip: req.ip,
        });
        throw err;
      }
    });
  }

  app.delete('/:id', { preHandler: requirePermission('server.delete') }, async (req) => {
    const { id } = req.params as { id: string };
    const taskId = await ctx.apps.requestDelete(id, req.authedUser!.id);
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'app.delete',
      targetType: 'application', targetId: id, success: true, ip: req.ip,
    });
    return { taskId };
  });

  app.post('/:id/console', { preHandler: requirePermission('server.console') }, async (req) => {
    const { id } = req.params as { id: string };
    const { command } = req.body as { command?: string };
    if (!command || typeof command !== 'string' || command.length > 2000) {
      throw ApiError.badRequest('command required');
    }
    await ctx.apps.sendConsole(id, command);
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'app.console',
      targetType: 'application', targetId: id, args: { command }, success: true, ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/:id/logs', { preHandler: requirePermission('server.console') }, async (req) => {
    const { id } = req.params as { id: string };
    const { lines } = req.query as { lines?: string };
    return ctx.apps.tailLogs(id, Math.min(Number(lines ?? 200) || 200, 2000));
  });

  /* ---------------- File manager ---------------- */

  app.get('/:id/files', { preHandler: requirePermission('files.read') }, async (req) => {
    const { id } = req.params as { id: string };
    const { path } = req.query as { path?: string };
    const a = await ctx.apps.get(id);
    return ctx.nodes.command(a.nodeId, {
      op: 'fs.list',
      appId: id,
      path: path ? requirePath(path) : '.',
    });
  });

  app.get('/:id/files/content', { preHandler: requirePermission('files.read') }, async (req) => {
    const { id } = req.params as { id: string };
    const { path } = req.query as { path?: string };
    const a = await ctx.apps.get(id);
    return ctx.nodes.command(a.nodeId, {
      op: 'fs.read',
      appId: id,
      path: requirePath(path),
      maxBytes: 2097152,
    });
  });

  app.put('/:id/files/content', { preHandler: requirePermission('files.write') }, async (req) => {
    const { id } = req.params as { id: string };
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
      actor: 'user', userId: req.authedUser!.id, action: 'files.write',
      targetType: 'application', targetId: id, args: { path: body.path }, success: true, ip: req.ip,
    });
    return { ok: true };
  });

  app.post('/:id/files/mkdir', { preHandler: requirePermission('files.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const { path } = req.body as { path?: string };
    const a = await ctx.apps.get(id);
    await ctx.nodes.command(a.nodeId, { op: 'fs.mkdir', appId: id, path: requirePath(path) });
    return { ok: true };
  });

  app.post('/:id/files/rename', { preHandler: requirePermission('files.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const { from, to } = req.body as { from?: string; to?: string };
    const a = await ctx.apps.get(id);
    await ctx.nodes.command(a.nodeId, { op: 'fs.rename', appId: id, from: requirePath(from), to: requirePath(to) });
    return { ok: true };
  });

  app.post('/:id/files/delete', { preHandler: requirePermission('files.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const { path } = req.body as { path?: string };
    const a = await ctx.apps.get(id);
    await ctx.nodes.command(a.nodeId, { op: 'fs.delete', appId: id, path: requirePath(path) });
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'files.delete',
      targetType: 'application', targetId: id, args: { path }, success: true, ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/:id/files/search', { preHandler: requirePermission('files.read') }, async (req) => {
    const { id } = req.params as { id: string };
    const { query, path } = req.query as { query?: string; path?: string };
    if (!query) throw ApiError.badRequest('query required');
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
