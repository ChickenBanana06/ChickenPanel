import { z } from 'zod';

export const AI_PROVIDER_KINDS = ['anthropic', 'openai', 'google', 'openai-compatible'] as const;
export type AIProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/* ------------------------------------------------------------------ */
/* Interactive UI the AI can render in chat                            */
/* ------------------------------------------------------------------ */

export const UIComponentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('buttons'),
    id: z.string(),
    prompt: z.string(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).min(1).max(12),
  }),
  z.object({
    kind: z.literal('select'),
    id: z.string(),
    prompt: z.string(),
    multi: z.boolean().default(false),
    options: z.array(z.object({ label: z.string(), value: z.string() })).min(1).max(50),
  }),
  z.object({
    kind: z.literal('text_input'),
    id: z.string(),
    prompt: z.string(),
    placeholder: z.string().optional(),
    secret: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('number_input'),
    id: z.string(),
    prompt: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().optional(),
  }),
  z.object({
    kind: z.literal('slider'),
    id: z.string(),
    prompt: z.string(),
    min: z.number(),
    max: z.number(),
    step: z.number().default(1),
    unit: z.string().optional(),
  }),
  z.object({
    kind: z.literal('confirm'),
    id: z.string(),
    prompt: z.string(),
    danger: z.boolean().default(false),
    confirmLabel: z.string().default('Confirm'),
    cancelLabel: z.string().default('Cancel'),
  }),
  z.object({
    kind: z.literal('form'),
    id: z.string(),
    prompt: z.string(),
    fields: z
      .array(
        z.object({
          name: z.string(),
          label: z.string(),
          type: z.enum(['text', 'number', 'select', 'checkbox']),
          options: z.array(z.string()).optional(),
          required: z.boolean().default(false),
          defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
]);
export type UIComponent = z.infer<typeof UIComponentSchema>;

/* ------------------------------------------------------------------ */
/* Execution plans                                                     */
/* ------------------------------------------------------------------ */

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'running', 'done', 'failed']).default('pending'),
});

export const PlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.array(PlanStepSchema).min(1).max(50),
  status: z.enum(['proposed', 'approved', 'rejected', 'running', 'done', 'failed']).default('proposed'),
});
export type Plan = z.infer<typeof PlanSchema>;

/* ------------------------------------------------------------------ */
/* Message content parts (persisted + streamed)                        */
/* ------------------------------------------------------------------ */

export const MessagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    toolCallId: z.string(),
    name: z.string(),
    args: z.unknown(),
    status: z.enum(['pending', 'awaiting_approval', 'running', 'succeeded', 'failed', 'denied']),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('ui'), component: UIComponentSchema, response: z.unknown().optional() }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  /** Persisted result of a tool call (role: "tool" messages). */
  z.object({ type: z.literal('tool_result'), toolCallId: z.string(), content: z.string() }),
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;

export const AgentRunStateSchema = z.enum(['idle', 'running', 'waiting_input', 'waiting_approval', 'cancelled', 'errored']);
export type AgentRunState = z.infer<typeof AgentRunStateSchema>;

/* ------------------------------------------------------------------ */
/* Provider-facing chat types (wire-agnostic)                          */
/* ------------------------------------------------------------------ */

export interface ChatToolDef {
  name: string;
  description: string;
  /** JSON schema for arguments */
  parameters: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: { id: string; name: string; args: unknown }[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type ProviderStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: 'end' | 'tool_calls' | 'max_tokens' | 'error'; error?: string };

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  maxTokens?: number;
  temperature?: number;
}
