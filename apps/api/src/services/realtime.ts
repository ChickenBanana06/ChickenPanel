import type { WebSocket } from 'ws';

export type Topic = string;

export type TopicAuthorizer = (userId: string, topic: string) => Promise<boolean> | boolean;

interface Subscriber {
  socket: WebSocket;
  userId: string;
  topics: Set<Topic>;
}

/**
 * Fanout hub for UI WebSocket clients. Topics:
 *   node:{id}            — status + metrics
 *   app:{id}             — status, metrics
 *   app:{id}:console     — log/console lines
 *   task:{id}            — task progress/logs
 *   tasks                — task list changes
 *   chat:{conversationId}— AI stream events
 *   apps                 — application list changes
 *   nodes                — node list changes
 */
export class RealtimeHub {
  private subscribers = new Set<Subscriber>();

  register(socket: WebSocket, userId: string, authorizer?: TopicAuthorizer): void {
    const sub: Subscriber = { socket, userId, topics: new Set() };
    this.subscribers.add(sub);
    socket.on('message', async (raw: Buffer) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      const m = msg as { op?: string; topic?: string };
      if (typeof m.topic !== 'string' || m.topic.length > 200) return;
      if (m.op === 'sub') {
        if (authorizer) {
          try {
            const allowed = await authorizer(userId, m.topic);
            if (!allowed) {
              if (sub.socket.readyState === sub.socket.OPEN) {
                sub.socket.send(JSON.stringify({ op: 'error', topic: m.topic, error: 'Subscription forbidden' }));
              }
              return;
            }
          } catch {
            return;
          }
        }
        sub.topics.add(m.topic);
      } else if (m.op === 'unsub') {
        sub.topics.delete(m.topic);
      }
    });
    const cleanup = () => this.subscribers.delete(sub);
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  publish(topic: Topic, event: string, data: unknown, opts?: { userId?: string }): void {
    if (this.subscribers.size === 0) return;
    const payload = JSON.stringify({ topic, event, data });
    for (const sub of this.subscribers) {
      if (!sub.topics.has(topic)) continue;
      if (opts?.userId && sub.userId !== opts.userId) continue;
      if (sub.socket.readyState === sub.socket.OPEN) {
        sub.socket.send(payload);
      }
    }
  }

  get connectionCount(): number {
    return this.subscribers.size;
  }
}
