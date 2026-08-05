import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { BackupService } from '../services/backup-service.js';
export declare function taskRoutes(app: FastifyInstance, ctx: AppContext): Promise<void>;
export declare function backupRoutes(backups: BackupService): (app: FastifyInstance, ctx: AppContext) => Promise<void>;
export declare function auditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void>;
export declare function userRoutes(app: FastifyInstance, ctx: AppContext): Promise<void>;
/** Authenticated UI realtime WebSocket. */
export declare function realtimeWsRoute(app: FastifyInstance, ctx: AppContext): Promise<void>;
//# sourceMappingURL=misc.d.ts.map