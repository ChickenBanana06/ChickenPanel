import type { ChatMessage, ChatRequest, ProviderStreamEvent } from '@nexpanel/shared';
import { parseSSE } from './sse.js';
import { ProviderError, readErrorBody, type AIProviderClient, type ModelInfo } from './provider.js';

type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
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
 * OpenAI Chat Completions protocol. Also used for any OpenAI-compatible
 * endpoint (Ollama, vLLM, OpenRouter, …) and for Google Gemini via its
 * OpenAI-compatibility layer.
 */
export class OpenAIProvider implements AIProviderClient {
  constructor(
    public readonly kind: string,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`listModels failed: ${await readErrorBody(res)}`, res.status);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => ({ id: m.id, displayName: m.id }));
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
              function: { name: t.name, description: t.description, parameters: t.parameters },
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
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
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
        | { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
        | undefined;
      for (const tc of dToolCalls ?? []) {
        const existing = toolCalls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name += tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        toolCalls.set(tc.index, existing);
      }
      if (choice.finish_reason === 'tool_calls') stopReason = 'tool_calls';
      else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    }

    for (const [idx, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      let args: unknown = {};
      try {
        args = tc.args ? JSON.parse(tc.args) : {};
      } catch {
        args = { _malformed: tc.args };
      }
      yield { type: 'tool_call', id: tc.id || `tc_${idx}`, name: tc.name, args };
    }
    yield { type: 'usage', inputTokens: usageIn, outputTokens: usageOut };
    yield { type: 'done', stopReason };
  }
}
