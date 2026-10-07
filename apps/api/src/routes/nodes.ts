import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { CreateNodeSchema, newSecretToken, sha256Hex } from '@nexpanel/shared';
import type { AppContext } from '../context.js';
import { makeAuthHooks } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';

function defaultAgentDataDir(): string {
  if (process.env.NEXPANEL_AGENT_DATA) return process.env.NEXPANEL_AGENT_DATA;
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'nexpanel-agent');
}

export async function nodeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { requirePermission } = makeAuthHooks(ctx);

  app.get('/connect-info', { preHandler: requirePermission('server.read') }, async () => {
    return {
      apiPort: Number(process.env.NEXPANEL_API_PORT ?? 4000),
      hasOnlineNode: ctx.nodes.onlineNodeIds.length > 0,
      onlineCount: ctx.nodes.onlineNodeIds.length,
    };
  });

  app.post('/auto-connect-local', { preHandler: requirePermission('node.manage') }, async (req) => {
    const hostname = os.hostname();
    let node = await ctx.db.node.findFirst({
      where: {
        OR: [
          { name: 'Local Server' },
          { name: `Local Server (${hostname})` },
          { name: 'local-node-test' },
          { name: hostname },
        ],
      },
    });

    const token = `npn_${newSecretToken(32)}`;
    if (!node) {
      node = await ctx.db.node.create({
        data: {
          name: `Local Server (${hostname})`,
          description: 'Primary host machine (auto-configured local node)',
          tokenHash: sha256Hex(token),
        },
      });
    } else {
      await ctx.db.node.update({
        where: { id: node.id },
        data: { tokenHash: sha256Hex(token) },
      });
    }

    const panelUrl = `http://127.0.0.1:${process.env.NEXPANEL_API_PORT ?? 4000}`;
    const targetDirs = [defaultAgentDataDir()];
    if (process.platform !== 'win32' && fs.existsSync('/home/chickenpanel')) {
      targetDirs.push('/home/chickenpanel/.local/share/nexpanel-agent');
    }
    for (const dir of targetDirs) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify({ panelUrl, token }, null, 2), { mode: 0o600 });
        if (process.platform !== 'win32' && process.getuid && process.getuid() === 0 && dir.startsWith('/home/chickenpanel')) {
          try {
            const { execSync } = await import('node:child_process');
            execSync('chown -R chickenpanel:chickenpanel /home/chickenpanel/.local/share/nexpanel-agent', { stdio: 'ignore' });
          } catch {}
        }
      } catch {}
    }

    if (!ctx.nodes.isOnline(node.id)) {
      try {
        const repoRoot = path.resolve(process.cwd());
        const agentScript = path.join(repoRoot, 'agent', 'dist', 'index.js');
        if (fs.existsSync(agentScript)) {
          const child = spawn(process.execPath, [agentScript], {
            cwd: repoRoot,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          child.unref();
        }
      } catch (err) {
        req.log.warn({ err }, 'Could not spawn local agent process directly');
      }
    }

    for (let i = 0; i < 6; i++) {
      if (ctx.nodes.isOnline(node.id)) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'node.auto_connect_local',
      targetType: 'node', targetId: node.id, success: true, ip: req.ip,
    });

    return {
      ok: true,
      node: { id: node.id, name: node.name },
      connected: ctx.nodes.isOnline(node.id),
      message: ctx.nodes.isOnline(node.id)
        ? 'Local node connected and online!'
        : 'Local node configured. Agent process is connecting.',
    };
  });

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
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw ApiError.conflict('Node name already exists');
      throw err;
    }
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'node.create',
      targetType: 'node', targetId: node.id, success: true, ip: req.ip,
    });
    // The token is shown exactly once; only its hash is stored.
    return { node: { id: node.id, name: node.name }, registrationToken: token };
  });

  app.post('/:id/rotate-token', { preHandler: requirePermission('node.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const token = `npn_${newSecretToken(32)}`;
    await ctx.db.node.update({ where: { id }, data: { tokenHash: sha256Hex(token) } }).catch(() => {
      throw ApiError.notFound('Node not found');
    });
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'node.rotate_token',
      targetType: 'node', targetId: id, success: true, ip: req.ip,
    });
    return { registrationToken: token };
  });

  app.delete('/:id', { preHandler: requirePermission('node.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const appCount = await ctx.db.application.count({ where: { nodeId: id } });
    if (appCount > 0) throw ApiError.conflict('Node still has applications; delete them first');
    await ctx.db.node.delete({ where: { id } }).catch(() => {
      throw ApiError.notFound('Node not found');
    });
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'node.delete',
      targetType: 'node', targetId: id, success: true, ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/:id', { preHandler: requirePermission('server.read') }, async (req) => {
    const { id } = req.params as { id: string };
    const isAdmin = req.authedUser!.role === 'ADMIN';
    const node = await ctx.db.node.findUnique({
      where: { id },
      include: {
        applications: {
          where: isAdmin ? undefined : { createdById: req.authedUser!.id },
          select: { id: true, name: true, type: true, status: true, ports: true },
        },
      },
    });
    if (!node) throw ApiError.notFound('Node not found');
    const { tokenHash: _t, ...rest } = node;
    return { node: { ...rest, connected: ctx.nodes.isOnline(id) } };
  });
}

/** Agent WebSocket endpoint — token auth happens inside the protocol hello. */
export async function agentWsRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    ctx.nodes.handleConnection(socket as never);
  });
}
