import type { ChatMessage, ChatRequest, ProviderStreamEvent } from '@nexpanel/shared';
import { parseSSE } from './sse.js';
import { ProviderError, readErrorBody, type AIProviderClient, type ModelInfo } from './provider.js';

type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
        extra_content?: unknown;
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

function toOpenAIMessages(req: ChatRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  for (const m of req.messages) {
    if (m.role === 'system') {
      if (!req.system) out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const toolCalls = (m.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        // Round-trip provider metadata (e.g. Gemini requires echoing the
        // thought_signature it returned with the original function call).
        ...(tc.providerMeta ? { extra_content: tc.providerMeta } : {}),
      }));
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

/**
 * Google Gemini's function-calling accepts only a strict subset of JSON
 * Schema (a slice of OpenAPI 3.0). This recursively rewrites a tool schema
 * into that subset: unsupported keywords are dropped, and free-form objects
 * (no declared properties) are represented as a JSON string the model fills
 * in — the caller coerces it back to an object when parsing arguments.
 */
const GEMINI_SUPPORTED_KEYS = new Set([
  'type', 'format', 'description', 'nullable', 'enum', 'items', 'properties',
  'required', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'pattern', 'example',
]);

function sanitizeGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!GEMINI_SUPPORTED_KEYS.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = sanitizeGeminiSchema(pv);
      out.properties = props;
    } else if (k === 'items') {
      out.items = sanitizeGeminiSchema(v);
    } else if (k === 'anyOf' && Array.isArray(v)) {
      out.anyOf = v.map(sanitizeGeminiSchema);
    } else {
      out[k] = v;
    }
  }
  // Free-form object (e.g. z.record(z.unknown())): Gemini needs a concrete
  // leaf type, so express it as a JSON string.
  if (out.type === 'object' && (!out.properties || Object.keys(out.properties as object).length === 0)) {
    const desc = typeof out.description === 'string' ? out.description + ' ' : '';
    return { type: 'string', description: `${desc}(pass a JSON object encoded as a string)` };
  }
  return out;
}

/**
 * OpenAI Chat Completions protocol. Also used for any OpenAI-compatible
 * endpoint (Ollama, vLLM, OpenRouter, …) and for Google Gemini via its
 * OpenAI-compatibility layer.
 */
export class OpenAIProvider implements AIProviderClient {
  constructor(
    public readonly kind: string,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      ...this.extraHeaders,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`listModels failed: ${await readErrorBody(res)}`, res.status);
    const body = (await res.json()) as { data?: { id: string; name?: string }[] };
    return (body.data ?? []).map((m) => ({ id: m.id, displayName: m.name || m.id }));
  }

  async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    const payload = {
      model: req.model,
      messages: toOpenAIMessages(req),
      ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters:
                  this.kind === 'google'
                    ? (sanitizeGeminiSchema(t.parameters) as Record<string, unknown>)
                    : t.parameters,
              },
            })),
          }
        : {}),
      stream: true,
      stream_options: { include_usage: true },
    };

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) {
      yield { type: 'done', stopReason: 'error', error: `Provider error ${res.status}: ${await readErrorBody(res)}` };
      return;
    }

    let stopReason: 'end' | 'tool_calls' | 'max_tokens' = 'end';
    // Keyed so streamed OpenAI fragments merge by index, while providers that
    // send complete calls without an index (Gemini) stay separate by id.
    const toolCalls = new Map<string, { order: number; id: string; name: string; args: string; meta?: unknown }>();
    let toolOrder = 0;
    let usageIn = 0;
    let usageOut = 0;

    for await (const evt of parseSSE(res.body)) {
      if (evt.data === '[DONE]') break;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(evt.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
      if (usage) {
        usageIn = usage.prompt_tokens ?? usageIn;
        usageOut = usage.completion_tokens ?? usageOut;
      }
      const choice = (data.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'text', delta: delta.content };
      }
      const dToolCalls = delta.tool_calls as
        | { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[]
        | undefined;
      for (const tc of dToolCalls ?? []) {
        const key =
          typeof tc.index === 'number' ? `idx:${tc.index}` : tc.id ? `id:${tc.id}` : `ord:${toolOrder}`;
        let existing = toolCalls.get(key);
        if (!existing) {
          existing = { order: toolOrder++, id: '', name: '', args: '' };
          toolCalls.set(key, existing);
        }
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name += tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        if (tc.extra_content !== undefined) existing.meta = tc.extra_content;
      }
      if (choice.finish_reason === 'tool_calls') stopReason = 'tool_calls';
      else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    }

    for (const tc of [...toolCalls.values()].sort((a, b) => a.order - b.order)) {
      let args: unknown = {};
      try {
        args = tc.args ? JSON.parse(tc.args) : {};
      } catch {
        args = { _malformed: tc.args };
      }
      yield {
        type: 'tool_call',
        id: tc.id || `tc_${tc.order}`,
        name: tc.name,
        args,
        ...(tc.meta !== undefined ? { providerMeta: tc.meta } : {}),
      };
    }
    yield { type: 'usage', inputTokens: usageIn, outputTokens: usageOut };
    yield { type: 'done', stopReason };
  }
}
