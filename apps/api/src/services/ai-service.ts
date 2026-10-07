import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AIConversation, AIProvider, Prisma } from '@nexpanel/database';
import {
  resolvePermissions,
  MessagePartSchema,
  type ChatMessage,
  type ChatToolDef,
  type MessagePart,
  type Permission,
  type UIComponent,
} from '@nexpanel/shared';
import { createProviderClient, type AIProviderClient } from '@nexpanel/ai';
import type { AppContext } from '../context.js';
import { ApiError } from '../lib/errors.js';
import { encryptSecret, decryptSecret, maskSecret } from '../lib/crypto.js';
import { writeAudit, redactSecrets } from '../lib/audit.js';
import { ToolRegistry, ToolExecutionError } from './tools/registry.js';

const MAX_ITERATIONS_PER_RUN = 40;
const MAX_TOOL_RESULT_CHARS = 30000;

const AskUserArgsSchema = z.object({
  kind: z.enum(['buttons', 'select', 'text_input', 'number_input', 'slider', 'confirm', 'form']),
  prompt: z.string().min(1).max(2000),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  multi: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
  placeholder: z.string().optional(),
  danger: z.boolean().optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(['text', 'number', 'select', 'checkbox']),
        options: z.array(z.string()).optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
});

const ProposePlanArgsSchema = z.object({
  title: z.string().min(1).max(200),
  steps: z.array(z.object({ title: z.string().min(1).max(200), detail: z.string().max(2000).optional() })).min(1).max(50),
});

interface ActiveRun {
  abort: AbortController;
}

export class AIService {
  readonly tools = new ToolRegistry();
  private activeRuns = new Map<string, ActiveRun>();
  private getCtx: () => AppContext;

  constructor(getCtx: () => AppContext) {
    this.getCtx = getCtx;
  }

  private get ctx(): AppContext {
    return this.getCtx();
  }

  /* ---------------- Providers ---------------- */

  async upsertProvider(input: {
    id?: string;
    kind: string;
    displayName: string;
    apiKey?: string;
    baseUrl?: string | null;
    enabled: boolean;
  }): Promise<{ id: string }> {
    const data = {
      kind: input.kind,
      displayName: input.displayName,
      baseUrl: input.baseUrl ?? null,
      enabled: input.enabled,
      ...(input.apiKey ? { apiKeyEnc: encryptSecret(input.apiKey, this.ctx.config.secret) } : {}),
    };
    if (input.id) {
      const updated = await this.ctx.db.aIProvider.update({ where: { id: input.id }, data });
      return { id: updated.id };
    }
    if (!input.apiKey && input.kind !== 'openai-compatible') {
      throw ApiError.badRequest('API key is required');
    }
    const created = await this.ctx.db.aIProvider.create({
      data: { ...data, apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey, this.ctx.config.secret) : null },
    });
    return { id: created.id };
  }

  /** Providers with masked keys — full keys never leave the server. */
  async listProviders(): Promise<
    { id: string; kind: string; displayName: string; baseUrl: string | null; enabled: boolean; apiKeyMasked: string | null }[]
  > {
    const rows = await this.ctx.db.aIProvider.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      apiKeyMasked: p.apiKeyEnc ? maskSecret(this.decryptKey(p)) : null,
    }));
  }

  async deleteProvider(id: string): Promise<void> {
    const inUse = await this.ctx.db.aIConversation.count({ where: { providerId: id } });
    if (inUse > 0) throw ApiError.conflict('Provider is used by existing conversations');
    await this.ctx.db.aIProvider.delete({ where: { id } });
  }

  private decryptKey(provider: AIProvider): string {
    if (!provider.apiKeyEnc) return '';
    return decryptSecret(provider.apiKeyEnc, this.ctx.config.secret);
  }

  private clientFor(provider: AIProvider): AIProviderClient {
    return createProviderClient({
      kind: provider.kind as never,
      apiKey: this.decryptKey(provider),
      baseUrl: provider.baseUrl,
    });
  }

  /** Fetch models live from the provider and cache them. */
  async listModels(providerId: string, refresh = false): Promise<{ id: string; displayName: string }[]> {
    const provider = await this.ctx.db.aIProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw ApiError.notFound('Provider not found');
    if (!refresh) {
      const cached = await this.ctx.db.aIModel.findMany({ where: { providerId } });
      if (cached.length > 0) return cached.map((m) => ({ id: m.modelId, displayName: m.displayName }));
    }
    try {
      const models = await this.clientFor(provider).listModels();
      await this.ctx.db.$transaction([
        this.ctx.db.aIModel.deleteMany({ where: { providerId } }),
        this.ctx.db.aIModel.createMany({
          data: models.slice(0, 200).map((m) => ({ providerId, modelId: m.id, displayName: m.displayName })),
        }),
      ]);
      return models;
    } catch (err) {
      const cached = await this.ctx.db.aIModel.findMany({ where: { providerId } });
      if (cached.length > 0) return cached.map((m) => ({ id: m.modelId, displayName: m.displayName }));
      throw ApiError.badRequest(`Could not list models: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /* ---------------- Conversations ---------------- */

  async createConversation(userId: string, input: { name: string; providerId: string; model: string }) {
    const provider = await this.ctx.db.aIProvider.findUnique({ where: { id: input.providerId } });
    if (!provider || !provider.enabled) throw ApiError.badRequest('Provider not found or disabled');
    return this.ctx.db.aIConversation.create({
      data: { name: input.name, userId, providerId: input.providerId, model: input.model, state: 'idle' },
    });
  }

  async listConversations(userId: string) {
    return this.ctx.db.aIConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { provider: { select: { displayName: true, kind: true } } },
    });
  }

  async getConversation(userId: string, id: string): Promise<AIConversation> {
    const conv = await this.ctx.db.aIConversation.findUnique({ where: { id } });
    if (!conv || conv.userId !== userId) throw ApiError.notFound('Conversation not found');
    return conv;
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    await this.getConversation(userId, id);
    this.cancelRun(id);
    await this.ctx.db.aIConversation.delete({ where: { id } });
  }

  async listMessages(userId: string, conversationId: string) {
    await this.getConversation(userId, conversationId);
    return this.ctx.db.aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /* ---------------- Message send / run control ---------------- */

  async sendUserMessage(userId: string, conversationId: string, content: string): Promise<void> {
    const conv = await this.getConversation(userId, conversationId);
    if (conv.state === 'running') throw ApiError.conflict('Agent is already running; cancel it first or wait');
    await this.ctx.db.aIMessage.create({
      data: { conversationId, role: 'user', parts: [{ type: 'text', text: content }] as Prisma.InputJsonValue },
    });
    await this.touch(conversationId);
    this.publish(conversationId, 'message.user', { content });
    this.startRun(conversationId);
  }

  cancelRun(conversationId: string): void {
    const run = this.activeRuns.get(conversationId);
    if (run) run.abort.abort();
    void this.setState(conversationId, 'cancelled');
  }

  /** Answer an interactive UI component created by ask_user. */
  async respondToUI(userId: string, conversationId: string, messageId: string, componentId: string, value: unknown) {
    await this.getConversation(userId, conversationId);
    const message = await this.ctx.db.aIMessage.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId) throw ApiError.notFound('Message not found');
    const parts = MessagePartSchema.array().parse(message.parts);
    let toolCallId: string | null = null;
    const updated = parts.map((p) => {
      if (p.type === 'ui' && p.component.id === componentId) {
        if (p.response !== undefined) throw ApiError.conflict('Already answered');
        toolCallId = componentId;
        return { ...p, response: value };
      }
      return p;
    });
    if (!toolCallId) throw ApiError.notFound('Component not found');
    await this.ctx.db.aIMessage.update({
      where: { id: messageId },
      data: { parts: updated as Prisma.InputJsonValue },
    });
    await this.appendToolResult(conversationId, toolCallId, JSON.stringify({ answer: value }));
    await this.updateToolCallRow(conversationId, toolCallId, 'succeeded', { answer: value });
    this.publish(conversationId, 'ui.answered', { messageId, componentId, value });
    this.startRun(conversationId);
  }

  /** Approve or deny a dangerous tool call awaiting approval. */
  async resolveApproval(userId: string, conversationId: string, toolCallId: string, approve: boolean) {
    await this.getConversation(userId, conversationId);
    const row = await this.ctx.db.aIToolCall.findFirst({ where: { conversationId, toolCallId } });
    if (!row || row.status !== 'awaiting_approval') throw ApiError.notFound('No approval pending for this call');
    if (approve) {
      await this.ctx.db.aIToolCall.update({ where: { id: row.id }, data: { status: 'approved' } });
    } else {
      await this.ctx.db.aIToolCall.update({
        where: { id: row.id },
        data: { status: 'denied', finishedAt: new Date() },
      });
      await this.updateAssistantToolCallPart(conversationId, toolCallId, { status: 'denied' });
      await this.appendToolResult(conversationId, toolCallId, JSON.stringify({ error: 'Denied by user' }));
    }
    this.publish(conversationId, 'tool.approval', { toolCallId, approved: approve });
    this.startRun(conversationId);
  }

  /** Approve or reject a proposed plan. */
  async resolvePlan(userId: string, conversationId: string, messageId: string, planId: string, approve: boolean) {
    await this.getConversation(userId, conversationId);
    const message = await this.ctx.db.aIMessage.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId) throw ApiError.notFound('Message not found');
    const parts = MessagePartSchema.array().parse(message.parts);
    let found = false;
    const updated = parts.map((p) => {
      if (p.type === 'plan' && p.plan.id === planId && p.plan.status === 'proposed') {
        found = true;
        return { ...p, plan: { ...p.plan, status: approve ? 'approved' : 'rejected' } };
      }
      return p;
    });
    if (!found) throw ApiError.notFound('Plan not found or already resolved');
    await this.ctx.db.aIMessage.update({ where: { id: messageId }, data: { parts: updated as Prisma.InputJsonValue } });
    await this.appendToolResult(
      conversationId,
      planId,
      JSON.stringify({ plan: approve ? 'approved' : 'rejected', note: approve ? 'Execute the plan now.' : 'User rejected the plan.' }),
    );
    await this.updateToolCallRow(conversationId, planId, approve ? 'succeeded' : 'denied', { approved: approve });
    this.publish(conversationId, 'plan.resolved', { messageId, planId, approved: approve });
    this.startRun(conversationId);
  }

  /* ---------------- The agent loop ---------------- */

  /** Start (or resume) the agent loop for a conversation. No-op if already running. */
  startRun(conversationId: string): void {
    if (this.activeRuns.has(conversationId)) return;
    const run: ActiveRun = { abort: new AbortController() };
    this.activeRuns.set(conversationId, run);
    void this.runLoop(conversationId, run)
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ai] run loop error for ${conversationId}:`, err);
        // Persist a visible error message so the user always sees what went
        // wrong. Use a plain-ASCII marker so this save can't itself fail.
        await this.persistAssistantMessage(conversationId, [
          { type: 'text', text: `[error] The assistant run failed: ${sanitizeForStorage(message)}` },
        ]).catch((persistErr) => console.error('[ai] failed to persist run error message:', persistErr));
        await this.setState(conversationId, 'errored');
        this.publish(conversationId, 'run.error', { error: message });
      })
      .finally(() => {
        this.activeRuns.delete(conversationId);
      });
  }

  private async runLoop(conversationId: string, run: ActiveRun): Promise<void> {
    const conv = await this.ctx.db.aIConversation.findUnique({
      where: { id: conversationId },
      include: { provider: true, user: true },
    });
    if (!conv) return;
    const permissions = resolvePermissions(
      conv.user.role,
      conv.user.grantedPermissions,
      conv.user.revokedPermissions,
    );
    if (!permissions.has('ai.use')) {
      await this.setState(conversationId, 'errored');
      return;
    }
    const client = this.clientFor(conv.provider);

    // Resume: execute any tool calls persisted but not yet answered.
    const resumed = await this.executePendingToolCalls(conv.id, conv.userId, conv.user.role, permissions, run);
    if (resumed === 'paused') return;

    await this.setState(conversationId, 'running');

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_RUN; iteration++) {
      if (run.abort.signal.aborted) {
        await this.setState(conversationId, 'cancelled');
        return;
      }
      const history = await this.buildChatMessages(conversationId);
      // Nothing to respond to (e.g. resumed conversation with no new input).
      const last = history[history.length - 1];
      if (!last || last.role === 'assistant') {
        await this.setState(conversationId, 'idle');
        return;
      }

      const toolDefs = this.buildToolDefs(permissions);
      const parts: MessagePart[] = [];
      let text = '';
      let thinking = '';
      const toolCalls: { id: string; name: string; args: unknown; providerMeta?: unknown }[] = [];
      let usage: { inputTokens: number; outputTokens: number } | null = null;
      let streamError: string | null = null;

      const stream = client.streamChat(
        {
          model: conv.model,
          system: this.systemPrompt(conv),
          messages: history,
          tools: toolDefs,
          maxTokens: 8192,
        },
        run.abort.signal,
      );

      try {
        for await (const evt of stream) {
          if (evt.type === 'text') {
            text += evt.delta;
            this.publish(conversationId, 'stream.text', { delta: evt.delta });
          } else if (evt.type === 'thinking') {
            thinking += evt.delta;
          } else if (evt.type === 'tool_call') {
            toolCalls.push({ id: evt.id, name: evt.name, args: evt.args, providerMeta: evt.providerMeta });
          } else if (evt.type === 'usage') {
            usage = { inputTokens: evt.inputTokens, outputTokens: evt.outputTokens };
          } else if (evt.type === 'done' && evt.stopReason === 'error') {
            streamError = evt.error ?? 'Unknown provider error';
          }
        }
      } catch (err) {
        if (run.abort.signal.aborted) {
          await this.setState(conversationId, 'cancelled');
          return;
        }
        streamError = err instanceof Error ? err.message : String(err);
      }

      if (streamError) {
        // Surface provider errors to the user instead of hiding them.
        const errText = `[provider error] ${sanitizeForStorage(streamError)}`;
        await this.persistAssistantMessage(conversationId, [{ type: 'text', text: errText }], usage);
        this.publish(conversationId, 'stream.text', { delta: errText });
        await this.setState(conversationId, 'errored');
        this.publish(conversationId, 'run.done', { state: 'errored' });
        return;
      }

      if (thinking) parts.push({ type: 'thinking', text: thinking });
      if (text) parts.push({ type: 'text', text });
      for (const tc of toolCalls) {
        parts.push({
          type: 'tool_call',
          toolCallId: tc.id,
          name: tc.name,
          args: tc.args,
          status: 'pending',
          ...(tc.providerMeta !== undefined ? { providerMeta: tc.providerMeta } : {}),
        });
      }
      const assistantMsg = await this.persistAssistantMessage(conversationId, parts, usage);
      this.publish(conversationId, 'message.assistant', { messageId: assistantMsg.id });

      if (toolCalls.length === 0) {
        await this.setState(conversationId, 'idle');
        this.publish(conversationId, 'run.done', { state: 'idle' });
        return;
      }

      // Record tool call rows, then execute (may pause for input/approval).
      for (const tc of toolCalls) {
        await this.ctx.db.aIToolCall.create({
          data: {
            conversationId,
            toolCallId: tc.id,
            name: tc.name,
            args: redactSecrets(tc.args) as Prisma.InputJsonValue,
            status: 'pending',
          },
        });
      }
      const outcome = await this.executePendingToolCalls(conversationId, conv.userId, conv.user.role, permissions, run);
      if (outcome === 'paused') return;
    }

    await this.persistAssistantMessage(conversationId, [
      { type: 'text', text: '⚠️ Stopped: maximum tool iterations reached for this run. Send a message to continue.' },
    ]);
    await this.setState(conversationId, 'idle');
    this.publish(conversationId, 'run.done', { state: 'idle' });
  }

  /**
   * Execute tool calls that have no result yet, in order.
   * Returns 'paused' when the loop must wait for user input/approval.
   */
  private async executePendingToolCalls(
    conversationId: string,
    userId: string,
    role: string,
    permissions: Set<Permission>,
    run: ActiveRun,
  ): Promise<'continue' | 'paused'> {
    const pending = await this.findPendingToolCalls(conversationId);
    for (const tc of pending) {
      if (run.abort.signal.aborted) return 'paused';
      const row = await this.ctx.db.aIToolCall.findFirst({ where: { conversationId, toolCallId: tc.toolCallId } });
      const rowStatus = row?.status ?? 'pending';
      if (rowStatus === 'awaiting_approval') {
        await this.setState(conversationId, 'waiting_approval');
        return 'paused';
      }

      if (tc.name === 'ask_user') {
        const handled = await this.handleAskUser(conversationId, tc);
        if (handled === 'paused') return 'paused';
        continue;
      }
      if (tc.name === 'propose_plan') {
        const handled = await this.handleProposePlan(conversationId, tc);
        if (handled === 'paused') return 'paused';
        continue;
      }

      const tool = this.ctx.ai.tools.get(tc.name);
      if (!tool) {
        await this.finishToolCall(conversationId, tc.toolCallId, 'failed', { error: `Unknown tool: ${tc.name}` });
        continue;
      }
      if (!permissions.has(tool.permission)) {
        await this.finishToolCall(conversationId, tc.toolCallId, 'failed', {
          error: `Permission denied: ${tool.permission} is required`,
        });
        await writeAudit(this.ctx.db, {
          actor: 'ai', userId, conversationId, action: `tool.${tc.name}`,
          args: tc.args, success: false, error: 'permission denied',
        });
        continue;
      }
      if (tool.dangerous && rowStatus !== 'approved') {
        await this.ctx.db.aIToolCall.updateMany({
          where: { conversationId, toolCallId: tc.toolCallId },
          data: { status: 'awaiting_approval' },
        });
        await this.updateAssistantToolCallPart(conversationId, tc.toolCallId, { status: 'awaiting_approval' });
        await this.setState(conversationId, 'waiting_approval');
        this.publish(conversationId, 'tool.awaiting_approval', {
          toolCallId: tc.toolCallId,
          name: tc.name,
          args: redactSecrets(tc.args),
        });
        return 'paused';
      }

      // Execute
      await this.ctx.db.aIToolCall.updateMany({
        where: { conversationId, toolCallId: tc.toolCallId },
        data: { status: 'running' },
      });
      await this.updateAssistantToolCallPart(conversationId, tc.toolCallId, { status: 'running' });
      this.publish(conversationId, 'tool.running', { toolCallId: tc.toolCallId, name: tc.name });

      let result: unknown;
      let success = true;
      let errorMsg: string | undefined;
      try {
        let parsed = tool.argsSchema.safeParse(tc.args ?? {});
        if (!parsed.success && tc.args && typeof tc.args === 'object') {
          // Fallback for providers (e.g. Gemini) that encode object/array
          // arguments as JSON strings: parse those strings and retry once.
          parsed = tool.argsSchema.safeParse(coerceJsonStringArgs(tc.args as Record<string, unknown>));
        }
        if (!parsed.success) {
          throw new ToolExecutionError(
            `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
          );
        }
        result = await tool.execute(parsed.data as never, {
          ctx: this.ctx,
          conversationId,
          userId,
          role,
          permissions,
          workspaceId: (await this.ctx.db.aIConversation.findUnique({ where: { id: conversationId } }))?.workspaceId ?? null,
          signal: run.abort.signal,
        });
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : String(err);
        result = { error: errorMsg };
      }

      await writeAudit(this.ctx.db, {
        actor: 'ai', userId, conversationId, action: `tool.${tc.name}`,
        targetType: 'tool', targetId: tc.toolCallId,
        args: tc.args, success, error: errorMsg,
      });
      await this.finishToolCall(conversationId, tc.toolCallId, success ? 'succeeded' : 'failed', result);
    }
    return 'continue';
  }

  private async handleAskUser(
    conversationId: string,
    tc: { toolCallId: string; args: unknown },
  ): Promise<'paused' | 'done'> {
    const parsed = AskUserArgsSchema.safeParse(tc.args ?? {});
    if (!parsed.success) {
      await this.finishToolCall(conversationId, tc.toolCallId, 'failed', {
        error: `Invalid ask_user arguments: ${parsed.error.issues[0]?.message}`,
      });
      return 'done';
    }
    const a = parsed.data;
    const base = { id: tc.toolCallId, prompt: a.prompt };
    let component: UIComponent;
    switch (a.kind) {
      case 'buttons':
        component = { kind: 'buttons', ...base, options: a.options ?? [] };
        break;
      case 'select':
        component = { kind: 'select', ...base, multi: a.multi ?? false, options: a.options ?? [] };
        break;
      case 'text_input':
        component = { kind: 'text_input', ...base, placeholder: a.placeholder, secret: false };
        break;
      case 'number_input':
        component = { kind: 'number_input', ...base, min: a.min, max: a.max, unit: a.unit };
        break;
      case 'slider':
        component = { kind: 'slider', ...base, min: a.min ?? 0, max: a.max ?? 100, step: a.step ?? 1, unit: a.unit };
        break;
      case 'confirm':
        component = { kind: 'confirm', ...base, danger: a.danger ?? false, confirmLabel: 'Confirm', cancelLabel: 'Cancel' };
        break;
      case 'form':
        component = {
          kind: 'form',
          ...base,
          fields: (a.fields ?? []).map((f) => ({ ...f, required: f.required ?? false })),
        };
        break;
    }
    const message = await this.ctx.db.aIMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        parts: [{ type: 'ui', component }] as unknown as Prisma.InputJsonValue,
      },
    });
    await this.updateToolCallRow(conversationId, tc.toolCallId, 'awaiting_input', undefined);
    await this.setState(conversationId, 'waiting_input');
    this.publish(conversationId, 'ui.ask', { messageId: message.id, component });
    return 'paused';
  }

  private async handleProposePlan(
    conversationId: string,
    tc: { toolCallId: string; args: unknown },
  ): Promise<'paused' | 'done'> {
    const parsed = ProposePlanArgsSchema.safeParse(tc.args ?? {});
    if (!parsed.success) {
      await this.finishToolCall(conversationId, tc.toolCallId, 'failed', {
        error: `Invalid propose_plan arguments: ${parsed.error.issues[0]?.message}`,
      });
      return 'done';
    }
    const plan = {
      id: tc.toolCallId,
      title: parsed.data.title,
      status: 'proposed' as const,
      steps: parsed.data.steps.map((s, i) => ({ id: `step_${i}`, title: s.title, detail: s.detail, status: 'pending' as const })),
    };
    const message = await this.ctx.db.aIMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        parts: [{ type: 'plan', plan }] as unknown as Prisma.InputJsonValue,
      },
    });
    await this.updateToolCallRow(conversationId, tc.toolCallId, 'awaiting_input', undefined);
    await this.setState(conversationId, 'waiting_input');
    this.publish(conversationId, 'plan.proposed', { messageId: message.id, plan });
    return 'paused';
  }

  /* ---------------- Helpers ---------------- */

  /** Tool calls in the last assistant tool-bearing message that have no tool_result yet. */
  private async findPendingToolCalls(
    conversationId: string,
  ): Promise<{ toolCallId: string; name: string; args: unknown }[]> {
    const messages = await this.ctx.db.aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    const answered = new Set<string>();
    const calls: { toolCallId: string; name: string; args: unknown }[] = [];
    for (const m of messages) {
      const parts = this.parseParts(m.parts);
      for (const p of parts) {
        if (m.role === 'tool' && p.type === 'tool_result') answered.add(p.toolCallId);
        if (m.role === 'assistant' && p.type === 'tool_call') {
          calls.push({ toolCallId: p.toolCallId, name: p.name, args: p.args });
        }
        if (m.role === 'assistant' && p.type === 'ui') calls.push({ toolCallId: p.component.id, name: 'ask_user', args: {} });
        if (m.role === 'assistant' && p.type === 'plan') calls.push({ toolCallId: p.plan.id, name: 'propose_plan', args: {} });
      }
    }
    const pending = calls.filter((c) => !answered.has(c.toolCallId));
    // ask_user / propose_plan entries derived from parts are already rendered;
    // they are "pending" only until answered, and must not be re-created.
    return pending.filter((c) => {
      if (c.name === 'ask_user' || c.name === 'propose_plan') {
        // Their pause state is handled via conversation.state; skip re-execution.
        return false;
      }
      return true;
    });
  }

  private parseParts(raw: unknown): MessagePart[] {
    const parsed = MessagePartSchema.array().safeParse(raw);
    return parsed.success ? parsed.data : [];
  }

  private async buildChatMessages(conversationId: string): Promise<ChatMessage[]> {
    const messages = await this.ctx.db.aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    const out: ChatMessage[] = [];
    for (const m of messages) {
      const parts = this.parseParts(m.parts);
      if (m.role === 'user') {
        const text = parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
        if (text) out.push({ role: 'user', content: text });
      } else if (m.role === 'assistant') {
        const text = parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
        const toolCalls = parts
          .filter((p) => p.type === 'tool_call')
          .map((p) => {
            const t = p as Extract<MessagePart, { type: 'tool_call' }>;
            return { id: t.toolCallId, name: t.name, args: t.args, providerMeta: t.providerMeta };
          });
        for (const p of parts) {
          if (p.type === 'ui') {
            toolCalls.push({ id: p.component.id, name: 'ask_user', args: { prompt: p.component.prompt }, providerMeta: undefined });
          }
          if (p.type === 'plan') {
            toolCalls.push({ id: p.plan.id, name: 'propose_plan', args: { title: p.plan.title }, providerMeta: undefined });
          }
        }
        if (text || toolCalls.length > 0) {
          out.push({ role: 'assistant', content: text, ...(toolCalls.length > 0 ? { toolCalls } : {}) });
        }
      } else if (m.role === 'tool') {
        for (const p of parts) {
          if (p.type === 'tool_result') {
            out.push({ role: 'tool', toolCallId: p.toolCallId, content: p.content.slice(0, MAX_TOOL_RESULT_CHARS) });
          }
        }
      }
    }
    return out;
  }

  private buildToolDefs(permissions: Set<Permission>): ChatToolDef[] {
    const defs: ChatToolDef[] = this.tools.listFor(permissions).map((t) => ({
      name: t.name,
      description: t.description + (t.dangerous ? ' (Requires user approval before it runs.)' : ''),
      parameters: toToolSchema(t.argsSchema),
    }));
    defs.push({
      name: 'ask_user',
      description:
        'Ask the user a question with an interactive UI component (buttons, select, slider, text/number input, confirm dialog, or form). ' +
        'Use when a choice materially affects what you will do. The user can always also reply with free text.',
      parameters: toToolSchema(AskUserArgsSchema),
    });
    defs.push({
      name: 'propose_plan',
      description:
        'Present a multi-step execution plan for user approval before performing complex or multi-part work. ' +
        'Wait for the result before acting: it tells you whether the user approved.',
      parameters: toToolSchema(ProposePlanArgsSchema),
    });
    return defs;
  }

  private systemPrompt(conv: AIConversation & { provider: AIProvider }): string {
    return [
      'You are the built-in AI operator of ChickenPanel, a server management panel that manages Minecraft servers, Discord bots, websites, databases, files, backups and multi-node infrastructure.',
      'You act ONLY through the provided tools. The backend enforces permissions independently — a denied tool result means the platform refused, not the user.',
      'Key rules:',
      '- Never claim an action succeeded unless a tool result confirms it.',
      '- Show errors honestly and attempt to fix them (read logs, inspect files, retry builds).',
      '- For complex multi-step work, call propose_plan first and wait for approval.',
      '- Use ask_user for choices that materially change the outcome (versions, RAM, software). Users can always answer in free text instead.',
      '- Long operations return task ids; poll get_task for progress instead of assuming completion.',
      '- Dangerous operations (deletes, restores, shell commands) require explicit user approval; request them only when needed.',
      '- When creating applications, first check nodes (list_nodes) and catalogs (get_type_catalog). Never assume a port is free — the platform allocates ports.',
      `Current conversation workspace: ${conv.workspaceId ?? 'none — create one with create_workspace before coding tasks'}.`,
      `Today's date: ${new Date().toISOString().slice(0, 10)}.`,
    ].join('\n');
  }

  private async persistAssistantMessage(
    conversationId: string,
    parts: MessagePart[],
    usage?: { inputTokens: number; outputTokens: number } | null,
  ) {
    const msg = await this.ctx.db.aIMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        parts: parts as unknown as Prisma.InputJsonValue,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      },
    });
    await this.touch(conversationId);
    return msg;
  }

  private async appendToolResult(conversationId: string, toolCallId: string, content: string): Promise<void> {
    await this.ctx.db.aIMessage.create({
      data: {
        conversationId,
        role: 'tool',
        parts: [{ type: 'tool_result', toolCallId, content: content.slice(0, MAX_TOOL_RESULT_CHARS) }] as Prisma.InputJsonValue,
      },
    });
  }

  private async finishToolCall(conversationId: string, toolCallId: string, status: string, result: unknown) {
    const resultStr = JSON.stringify(result ?? null);
    await this.updateToolCallRow(conversationId, toolCallId, status, result);
    await this.updateAssistantToolCallPart(conversationId, toolCallId, {
      status: status as never,
      result: truncateForDisplay(result),
    });
    await this.appendToolResult(conversationId, toolCallId, resultStr);
    this.publish(conversationId, 'tool.finished', { toolCallId, status, result: truncateForDisplay(result) });
  }

  private async updateToolCallRow(conversationId: string, toolCallId: string, status: string, result: unknown) {
    await this.ctx.db.aIToolCall.updateMany({
      where: { conversationId, toolCallId },
      data: {
        status,
        ...(result !== undefined ? { result: redactSecrets(result) as Prisma.InputJsonValue } : {}),
        ...(status === 'succeeded' || status === 'failed' || status === 'denied' ? { finishedAt: new Date() } : {}),
      },
    });
  }

  private async updateAssistantToolCallPart(
    conversationId: string,
    toolCallId: string,
    patch: Partial<Extract<MessagePart, { type: 'tool_call' }>>,
  ): Promise<void> {
    const messages = await this.ctx.db.aIMessage.findMany({
      where: { conversationId, role: 'assistant' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    for (const message of messages) {
      const parts = this.parseParts(message.parts);
      let changed = false;
      const updated = parts.map((p) => {
        if (p.type === 'tool_call' && p.toolCallId === toolCallId) {
          changed = true;
          return { ...p, ...patch };
        }
        return p;
      });
      if (changed) {
        await this.ctx.db.aIMessage.update({
          where: { id: message.id },
          data: { parts: updated as unknown as Prisma.InputJsonValue },
        });
        return;
      }
    }
  }

  private async setState(conversationId: string, state: string): Promise<void> {
    await this.ctx.db.aIConversation
      .updateMany({ where: { id: conversationId }, data: { state } })
      .catch(() => undefined);
    this.publish(conversationId, 'state', { state });
  }

  private async touch(conversationId: string): Promise<void> {
    await this.ctx.db.aIConversation
      .updateMany({ where: { id: conversationId }, data: { updatedAt: new Date() } })
      .catch(() => undefined);
  }

  private publish(conversationId: string, event: string, data: unknown): void {
    this.ctx.realtime.publish(`chat:${conversationId}`, event, data);
  }
}

/**
 * Defensive cleanup for text that must be persisted even in edge cases:
 * strips lone surrogates and caps length. (The database is UTF-8, so this is
 * belt-and-suspenders for provider error strings.)
 */
function sanitizeForStorage(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, '').slice(0, 4000);
}

/**
 * Some providers (Gemini's function-calling) encode object/array arguments as
 * JSON strings. For any top-level string value that cleanly parses to an
 * object or array, use the parsed value. Non-JSON strings are left untouched,
 * so this is a safe no-op for other providers.
 */
function coerceJsonStringArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    // Gemini emits explicit null for unfilled optional parameters; drop them
    // so `.optional()` (non-nullable) fields validate.
    if (v === null) continue;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            out[k] = parsed;
            continue;
          }
        } catch {
          // not JSON — fall through and keep the string
        }
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * Convert a zod schema to a tool JSON Schema that every provider accepts.
 * Uses $refStrategy:'none' so all shared sub-schemas are inlined — Google
 * Gemini's function-calling rejects `$ref`/definition loops that OpenAI and
 * Anthropic tolerate.
 */
function toToolSchema(schema: Parameters<typeof zodToJsonSchema>[0]): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'openAi', $refStrategy: 'none' }) as Record<string, unknown>;
  delete json.$schema;
  delete (json as { definitions?: unknown }).definitions;
  return json;
}

function truncateForDisplay(value: unknown): unknown {
  const str = JSON.stringify(value ?? null);
  if (str.length <= 4000) return value;
  return { _truncated: true, preview: str.slice(0, 4000) };
}

export { AskUserArgsSchema, ProposePlanArgsSchema };
