import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { getDb } from '@nexpanel/database';
import type { ApiConfig } from './config.js';
import type { AppContext } from './context.js';
import { ApiError } from './lib/errors.js';
import { makeAuthHooks } from './plugins/auth.js';
import { NodeManager } from './services/node-manager.js';
import { RealtimeHub } from './services/realtime.js';
import { ExtensionRegistry } from './services/extension-registry.js';
import { TaskService } from './services/task-service.js';
import { AppService } from './services/app-service.js';
import { AIService } from './services/ai-service.js';
import { BackupService } from './services/backup-service.js';
import { registerCoreTools } from './services/tools/core-tools.js';
import { builtinExtensions } from './extensions/builtin.js';
import { minecraftExtension } from './extensions/minecraft.js';
import { authRoutes } from './routes/auth.js';
import { nodeRoutes, agentWsRoute } from './routes/nodes.js';
import { appRoutes } from './routes/apps.js';
import { aiRoutes } from './routes/ai.js';
import { taskRoutes, backupRoutes, auditRoutes, userRoutes, realtimeWsRoute } from './routes/misc.js';

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildServer(config: ApiConfig): Promise<BuiltServer> {
  const db = getDb();
  const realtime = new RealtimeHub();
  const nodes = new NodeManager(db, realtime);
  const extensions = new ExtensionRegistry();
  const tasks = new TaskService(db, realtime);

  // context is assembled progressively; services capture it lazily.
  const ctx = { config, db, nodes, realtime, extensions, tasks } as AppContext;
  const apps = new AppService(ctx);
  ctx.apps = apps;
  const ai = new AIService(() => ctx);
  ctx.ai = ai;

  const backups = new BackupService(ctx);
  registerCoreTools(ai.tools, backups);

  for (const ext of builtinExtensions) extensions.register(ext);
  extensions.register(minecraftExtension);

  const app = Fastify({
    logger: { level: process.env.NEXPANEL_LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy,
    bodyLimit: 12 * 1024 * 1024,
  });

  // Tolerate empty JSON bodies on action endpoints (POST without payload).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new ApiError(400, 'Invalid JSON body', 'bad_json'), undefined);
    }
  });

  await app.register(cookie);
  if (config.devCorsOrigin) {
    await app.register(cors, { origin: config.devCorsOrigin, credentials: true });
  }
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024 } });

  const { attachUser } = makeAuthHooks(ctx);
  app.addHook('preHandler', attachUser);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      void reply.status(err.statusCode).send({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof ZodError) {
      void reply.status(400).send({
        error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        code: 'validation',
      });
      return;
    }
    if (typeof (err as { statusCode?: number }).statusCode === 'number' && (err as { statusCode: number }).statusCode < 500) {
      void reply.status((err as { statusCode: number }).statusCode).send({ error: (err as Error).message });
      return;
    }
    req.log.error(err);
    void reply.status(500).send({ error: 'Internal server error', code: 'internal' });
  });

  app.get('/api/v1/health', async () => ({ ok: true, version: '0.1.0' }));

  await app.register(async (v1) => authRoutes(v1, ctx), { prefix: '/api/v1/auth' });
  await app.register(async (v1) => nodeRoutes(v1, ctx), { prefix: '/api/v1/nodes' });
  await app.register(async (v1) => appRoutes(v1, ctx), { prefix: '/api/v1/apps' });
  await app.register(async (v1) => aiRoutes(v1, ctx), { prefix: '/api/v1/ai' });
  await app.register(async (v1) => taskRoutes(v1, ctx), { prefix: '/api/v1/tasks' });
  await app.register(async (v1) => backupRoutes(backups)(v1, ctx), { prefix: '/api/v1/backups' });
  await app.register(async (v1) => auditRoutes(v1, ctx), { prefix: '/api/v1/audit' });
  await app.register(async (v1) => userRoutes(v1, ctx), { prefix: '/api/v1/users' });
  await app.register(async (v1) => agentWsRoute(v1, ctx), { prefix: '/api/v1/agent' });
  await app.register(async (v1) => realtimeWsRoute(v1, ctx), { prefix: '/api/v1/realtime' });

  return { app, ctx };
}
