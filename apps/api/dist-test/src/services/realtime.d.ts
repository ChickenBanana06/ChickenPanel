import type { WebSocket } from 'ws';
export type Topic = string;
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
export declare class RealtimeHub {
    private subscribers;
    register(socket: WebSocket, userId: string): void;
    publish(topic: Topic, event: string, data: unknown, opts?: {
        userId?: string;
    }): void;
    get connectionCount(): number;
}
//# sourceMappingURL=realtime.d.ts.map