import type { FastifyInstance } from 'fastify';
import { UpsertAIProviderSchema, CreateConversationSchema, UpdateConversationSchema, SendMessageSchema } from '@nexpanel/shared';
import type { AppContext } from '../context.js';
import { makeAuthHooks } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';

export async function aiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { requirePermission } = makeAuthHooks(ctx);

  /* ---------------- Provider configuration (admin) ---------------- */

  app.get('/providers', { preHandler: requirePermission('ai.use') }, async () => {
    // Masked keys only; full keys never leave the server.
    return { providers: await ctx.ai.listProviders() };
  });

  app.post('/providers', { preHandler: requirePermission('ai.configure') }, async (req) => {
    const body = UpsertAIProviderSchema.parse(req.body);
    const result = await ctx.ai.upsertProvider(body);
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'ai.provider.create',
      targetType: 'ai_provider', targetId: result.id,
      args: { kind: body.kind, displayName: body.displayName, baseUrl: body.baseUrl }, success: true, ip: req.ip,
    });
    return result;
  });

  app.patch('/providers/:id', { preHandler: requirePermission('ai.configure') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpsertAIProviderSchema.partial().parse(req.body);
    const existing = await ctx.db.aIProvider.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Provider not found');
    const result = await ctx.ai.upsertProvider({
      id,
      kind: body.kind ?? (existing.kind as never),
      displayName: body.displayName ?? existing.displayName,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl === undefined ? existing.baseUrl : body.baseUrl,
      enabled: body.enabled ?? existing.enabled,
    });
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'ai.provider.update',
      targetType: 'ai_provider', targetId: id, success: true, ip: req.ip,
    });
    return result;
  });

  app.delete('/providers/:id', { preHandler: requirePermission('ai.configure') }, async (req) => {
    const { id } = req.params as { id: string };
    await ctx.ai.deleteProvider(id);
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: 'ai.provider.delete',
      targetType: 'ai_provider', targetId: id, success: true, ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/providers/:id/models', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const { refresh } = req.query as { refresh?: string };
    return { models: await ctx.ai.listModels(id, refresh === '1') };
  });

  /* ---------------- Conversations ---------------- */

  app.get('/conversations', { preHandler: requirePermission('ai.use') }, async (req) => {
    return { conversations: await ctx.ai.listConversations(req.authedUser!.id) };
  });

  app.post('/conversations', { preHandler: requirePermission('ai.use') }, async (req) => {
    const body = CreateConversationSchema.parse(req.body);
    const conv = await ctx.ai.createConversation(req.authedUser!.id, body);
    return { conversation: conv };
  });

  app.get('/conversations/:id/messages', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const conv = await ctx.ai.getConversation(req.authedUser!.id, id);
    const messages = await ctx.ai.listMessages(req.authedUser!.id, id);
    return { conversation: conv, messages };
  });

  app.delete('/conversations/:id', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    await ctx.ai.deleteConversation(req.authedUser!.id, id);
    return { ok: true };
  });

  app.patch('/conversations/:id', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateConversationSchema.parse(req.body);
    await ctx.ai.getConversation(req.authedUser!.id, id);
    const updated = await ctx.db.aIConversation.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.autonomyLevel ? { autonomyLevel: body.autonomyLevel } : {}),
      },
    });
    return { conversation: updated };
  });

  app.post('/conversations/:id/messages', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = SendMessageSchema.parse(req.body);
    await ctx.ai.sendUserMessage(req.authedUser!.id, id, body.content);
    return { ok: true };
  });

  app.post('/conversations/:id/cancel', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    await ctx.ai.getConversation(req.authedUser!.id, id);
    ctx.ai.cancelRun(id);
    return { ok: true };
  });

  app.post('/conversations/:id/ui-response', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const { messageId, componentId, value } = req.body as { messageId?: string; componentId?: string; value?: unknown };
    if (!messageId || !componentId) throw ApiError.badRequest('messageId and componentId required');
    await ctx.ai.respondToUI(req.authedUser!.id, id, messageId, componentId, value ?? null);
    return { ok: true };
  });

  app.post('/conversations/:id/approve-tool', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const { toolCallId, approve } = req.body as { toolCallId?: string; approve?: boolean };
    if (!toolCallId || typeof approve !== 'boolean') throw ApiError.badRequest('toolCallId and approve required');
    await ctx.ai.resolveApproval(req.authedUser!.id, id, toolCallId, approve);
    await writeAudit(ctx.db, {
      actor: 'user', userId: req.authedUser!.id, action: approve ? 'ai.tool.approve' : 'ai.tool.deny',
      targetType: 'tool_call', targetId: toolCallId, conversationId: id, success: true, ip: req.ip,
    });
    return { ok: true };
  });

  app.post('/conversations/:id/resolve-plan', { preHandler: requirePermission('ai.use') }, async (req) => {
    const { id } = req.params as { id: string };
    const { messageId, planId, approve } = req.body as { messageId?: string; planId?: string; approve?: boolean };
    if (!messageId || !planId || typeof approve !== 'boolean') {
      throw ApiError.badRequest('messageId, planId and approve required');
    }
    await ctx.ai.resolvePlan(req.authedUser!.id, id, messageId, planId, approve);
    return { ok: true };
  });
}
