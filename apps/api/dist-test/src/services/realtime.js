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
    subscribers = new Set();
    register(socket, userId) {
        const sub = { socket, userId, topics: new Set() };
        this.subscribers.add(sub);
        socket.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString('utf8'));
            }
            catch {
                return;
            }
            const m = msg;
            if (typeof m.topic !== 'string' || m.topic.length > 200)
                return;
            if (m.op === 'sub')
                sub.topics.add(m.topic);
            else if (m.op === 'unsub')
                sub.topics.delete(m.topic);
        });
        const cleanup = () => this.subscribers.delete(sub);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
    }
    publish(topic, event, data, opts) {
        if (this.subscribers.size === 0)
            return;
        const payload = JSON.stringify({ topic, event, data });
        for (const sub of this.subscribers) {
            if (!sub.topics.has(topic))
                continue;
            if (opts?.userId && sub.userId !== opts.userId)
                continue;
            if (sub.socket.readyState === sub.socket.OPEN) {
                sub.socket.send(payload);
            }
        }
    }
    get connectionCount() {
        return this.subscribers.size;
    }
}
//# sourceMappingURL=realtime.js.map