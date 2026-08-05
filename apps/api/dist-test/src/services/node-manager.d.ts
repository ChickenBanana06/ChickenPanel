import type { WebSocket } from 'ws';
import type { PrismaClient } from '@nexpanel/database';
import { type AgentCommand } from '@nexpanel/shared';
import type { RealtimeHub } from './realtime.js';
/**
 * Hub for Node Agent connections. Agents dial in over WebSocket and
 * authenticate with their registration token; the control plane then issues
 * commands and receives events/heartbeats.
 */
export declare class NodeManager {
    private readonly db;
    private readonly realtime;
    private agents;
    private sweepTimer;
    constructor(db: PrismaClient, realtime: RealtimeHub);
    start(): void;
    stop(): void;
    isOnline(nodeId: string): boolean;
    get onlineNodeIds(): string[];
    /** Handle a new agent WebSocket connection (pre-auth: waits for hello). */
    handleConnection(socket: WebSocket): void;
    private authenticate;
    private handleMessage;
    private handleAppEvent;
    private handleDisconnect;
    private sweepOffline;
    private send;
    /**
     * Send a command to a node's agent and await the result.
     * Throws ApiError(503) when the node is offline.
     */
    command<T = unknown>(nodeId: string, cmd: AgentCommand, opts?: {
        timeoutMs?: number;
        onStream?: (channel: 'stdout' | 'stderr' | 'progress', chunk: string) => void;
    }): Promise<T>;
}
//# sourceMappingURL=node-manager.d.ts.map