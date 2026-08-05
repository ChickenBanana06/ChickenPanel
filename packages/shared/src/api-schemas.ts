import { z } from 'zod';
import { ResourceLimitsSchema, RestartPolicySchema } from './app.js';

/* Auth ------------------------------------------------------------- */

export const RegisterSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may contain letters, numbers, ., _ and -'),
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

export const LoginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(256),
});

/* Nodes ------------------------------------------------------------ */

export const CreateNodeSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
});

/* Applications ----------------------------------------------------- */

export const CreateApplicationSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9 _.-]+$/, 'Invalid characters in name'),
  type: z.string().min(1).max(64),
  nodeId: z.string(),
  limits: ResourceLimitsSchema.partial().optional(),
  restartPolicy: RestartPolicySchema.optional(),
  env: z.record(z.string().max(32768)).optional(),
  /** Extension-specific creation options (validated by the extension). */
  config: z.record(z.unknown()).default({}),
});

export const UpdateApplicationSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  limits: ResourceLimitsSchema.partial().optional(),
  restartPolicy: RestartPolicySchema.optional(),
  env: z.record(z.string().max(32768)).optional(),
  config: z.record(z.unknown()).optional(),
});

/* AI --------------------------------------------------------------- */

export const UpsertAIProviderSchema = z.object({
  kind: z.enum(['anthropic', 'openai', 'google', 'openai-compatible']),
  displayName: z.string().min(1).max(64),
  apiKey: z.string().min(1).max(4096).optional(),
  baseUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().default(true),
});

export const CreateConversationSchema = z.object({
  name: z.string().min(1).max(100).default('New chat'),
  providerId: z.string(),
  model: z.string().min(1).max(200),
});

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(200000),
});

export const UIResponseSchema = z.object({
  messageId: z.string(),
  componentId: z.string(),
  value: z.unknown(),
});

/* Files ------------------------------------------------------------ */

export const FileWriteSchema = z.object({
  path: z.string().min(1).max(4096),
  // Large enough for base64-encoded uploads up to ~64 MB.
  content: z.string().max(94371840),
  base64: z.boolean().default(false),
});

/* Tasks ------------------------------------------------------------ */

export const TaskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
