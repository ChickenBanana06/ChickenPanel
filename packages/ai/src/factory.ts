import type { AIProviderKind } from '@nexpanel/shared';
import type { AIProviderClient } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

export const GOOGLE_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export interface ProviderConfig {
  kind: AIProviderKind;
  apiKey: string;
  baseUrl?: string | null;
}

export function createProviderClient(cfg: ProviderConfig): AIProviderClient {
  switch (cfg.kind) {
    case 'anthropic':
      return new AnthropicProvider(cfg.apiKey, cfg.baseUrl ?? undefined);
    case 'openai':
      return new OpenAIProvider('openai', cfg.apiKey, cfg.baseUrl ?? undefined);
    case 'google':
      return new OpenAIProvider('google', cfg.apiKey, cfg.baseUrl ?? GOOGLE_OPENAI_BASE_URL);
    case 'openai-compatible': {
      if (!cfg.baseUrl) throw new Error('openai-compatible provider requires a baseUrl');
      return new OpenAIProvider('openai-compatible', cfg.apiKey, cfg.baseUrl);
    }
  }
}
