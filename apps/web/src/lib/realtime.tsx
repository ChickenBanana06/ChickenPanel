'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { realtimeUrl } from './api';

export interface RealtimeEvent {
  topic: string;
  event: string;
  data: unknown;
}

type Listener = (evt: RealtimeEvent) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private refCounts = new Map<string, number>();
  private closed = false;
  private reconnectDelay = 1000;

  connect(): void {
    if (this.closed || this.ws) return;
    try {
      this.ws = new WebSocket(realtimeUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      for (const topic of this.refCounts.keys()) {
        this.ws?.send(JSON.stringify({ op: 'sub', topic }));
      }
    };
    this.ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as RealtimeEvent;
        for (const l of this.listeners.get(evt.topic) ?? []) l(evt);
      } catch {
        // ignore malformed
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
  }

  subscribe(topic: string, listener: Listener): () => void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(listener);
    this.listeners.set(topic, set);
    const count = (this.refCounts.get(topic) ?? 0) + 1;
    this.refCounts.set(topic, count);
    if (count === 1 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'sub', topic }));
    }
    return () => {
      set.delete(listener);
      const c = (this.refCounts.get(topic) ?? 1) - 1;
      if (c <= 0) {
        this.refCounts.delete(topic);
        this.listeners.delete(topic);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 'unsub', topic }));
        }
      } else {
        this.refCounts.set(topic, c);
      }
    };
  }

  destroy(): void {
    this.closed = true;
    this.ws?.close();
  }
}

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<RealtimeClient | null>(null);
  const client = useMemo(() => {
    if (!clientRef.current) clientRef.current = new RealtimeClient();
    return clientRef.current;
  }, []);
  useEffect(() => {
    client.connect();
    return () => client.destroy();
  }, [client]);
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

/** Subscribe to a realtime topic while mounted. */
export function useRealtimeTopic(topic: string | null, onEvent: Listener): void {
  const client = useContext(RealtimeContext);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!client || !topic) return;
    return client.subscribe(topic, (evt) => handler.current(evt));
  }, [client, topic]);
}
