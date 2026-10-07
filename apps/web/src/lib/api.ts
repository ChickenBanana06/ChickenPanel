'use client';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin API calls (proxied to the control plane by Next rewrites). */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-nexpanel-csrf': '1' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep default
    }
    throw new ApiClientError(res.status, message);
  }
  return (await res.json()) as T;
}

export const fetcher = <T,>(path: string): Promise<T> => api<T>('GET', path);

/** Control-plane WebSocket URL. Uses direct API port when accessed via 3000, or same-origin when proxied. */
export function realtimeUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (window.location.port === '3000') {
    return `${proto}://${window.location.hostname}:${process.env.NEXT_PUBLIC_API_PORT ?? '4000'}/api/v1/realtime/ws`;
  }
  const portSuffix = window.location.port ? `:${window.location.port}` : '';
  return `${proto}://${window.location.hostname}${portSuffix}/api/v1/realtime/ws`;
}
