import { type FastifyInstance } from 'fastify';
import type { ApiConfig } from './config.js';
import type { AppContext } from './context.js';
export interface BuiltServer {
    app: FastifyInstance;
    ctx: AppContext;
}
export declare function buildServer(config: ApiConfig): Promise<BuiltServer>;
//# sourceMappingURL=server.d.ts.map