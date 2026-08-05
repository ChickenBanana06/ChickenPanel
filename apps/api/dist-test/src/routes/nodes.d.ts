import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
export declare function nodeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void>;
/** Agent WebSocket endpoint — token auth happens inside the protocol hello. */
export declare function agentWsRoute(app: FastifyInstance, ctx: AppContext): Promise<void>;
//# sourceMappingURL=nodes.d.ts.map