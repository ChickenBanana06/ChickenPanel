import type { ChatMessage, ChatRequest, ProviderStreamEvent } from '@nexpanel/shared';
import { parseSSE } from './sse.js';
import { ProviderError, readErrorBody, type AIProviderClient, type ModelInfo } from './provider.js';

const API_VERSION = '2023-06-01';

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', content: AnthropicContent) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(content);
    else out.push({ role, content: [content] });
  };
  for (const m of messages) {
    if (m.role === 'system') continue; // carried separately
    if (m.role === 'user') push('user', { type: 'text', text: m.content });
    else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        push('assistant', { type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
      }
    } else if (m.role === 'tool') {
      push('user', { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

export class AnthropicProvider implements AIProviderClient {
  kind = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': API_VERSION,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/models?limit=100`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`Anthropic listModels failed: ${await readErrorBody(res)}`, res.status);
    const body = (await res.json()) as { data: { id: string; display_name?: string }[] };
    return body.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
  }

  async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    const system = req.system ?? req.messages.find((m) => m.role === 'system')?.content;
    const payload = {
      model: req.model,
      max_tokens: req.maxTokens ?? 8192,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(req.messages),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
      stream: true,
    };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) {
      yield { type: 'done', stopReason: 'error', error: `Anthropic error ${res.status}: ${await readErrorBody(res)}` };
      return;
    }

    let stopReason: 'end' | 'tool_calls' | 'max_tokens' = 'end';
    // Accumulate tool_use blocks until their JSON is complete.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    let usageIn = 0;
    let usageOut = 0;

    for await (const evt of parseSSE(res.body)) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(evt.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = data.type as string;
      if (type === 'message_start') {
        const usage = (data.message as { usage?: { input_tokens?: number } })?.usage;
        usageIn = usage?.input_tokens ?? 0;
      } else if (type === 'content_block_start') {
        const idx = data.index as number;
        const block = data.content_block as { type: string; id?: string; name?: string };
        if (block.type === 'tool_use') {
          toolBlocks.set(idx, { id: block.id ?? `tc_${idx}`, name: block.name ?? '', json: '' });
        }
      } else if (type === 'content_block_delta') {
        const idx = data.index as number;
        const delta = data.delta as { type: string; text?: string; partial_json?: string; thinking?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'text', delta: delta.text };
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          yield { type: 'thinking', delta: delta.thinking };
        } else if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) {
          const tb = toolBlocks.get(idx);
          if (tb) tb.json += delta.partial_json;
        }
      } else if (type === 'content_block_stop') {
        const idx = data.index as number;
        const tb = toolBlocks.get(idx);
        if (tb) {
          toolBlocks.delete(idx);
          let args: unknown = {};
          try {
            args = tb.json ? JSON.parse(tb.json) : {};
          } catch {
            args = { _malformed: tb.json };
          }
          yield { type: 'tool_call', id: tb.id, name: tb.name, args };
        }
      } else if (type === 'message_delta') {
        const delta = data.delta as { stop_reason?: string };
        const usage = data.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens) usageOut = usage.output_tokens;
        if (delta?.stop_reason === 'tool_use') stopReason = 'tool_calls';
        else if (delta?.stop_reason === 'max_tokens') stopReason = 'max_tokens';
      } else if (type === 'error') {
        const err = data.error as { message?: string };
        yield { type: 'done', stopReason: 'error', error: err?.message ?? 'provider error' };
        return;
      }
    }
    yield { type: 'usage', inputTokens: usageIn, outputTokens: usageOut };
    yield { type: 'done', stopReason };
  }
}
