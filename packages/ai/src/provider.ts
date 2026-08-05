import type { ChatRequest, ProviderStreamEvent } from '@nexpanel/shared';

export interface ModelInfo {
  id: string;
  displayName: string;
}

/**
 * Wire-agnostic provider client. Implementations translate the shared
 * ChatRequest into their provider protocol and normalize streaming events.
 */
export interface AIProviderClient {
  kind: string;
  streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent>;
  listModels(): Promise<ModelInfo[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 2000);
  } catch {
    return '(no body)';
  }
}
