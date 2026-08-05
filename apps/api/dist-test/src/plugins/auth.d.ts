import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Permission } from '@nexpanel/shared';
import type { AppContext } from '../context.js';
export interface AuthedUser {
    id: string;
    username: string;
    email: string;
    role: string;
    permissions: Set<Permission>;
    sessionId: string;
}
declare module 'fastify' {
    interface FastifyRequest {
        authedUser: AuthedUser | null;
    }
}
export declare function resolveSession(ctx: AppContext, token: string | undefined): Promise<AuthedUser | null>;
export declare function makeAuthHooks(ctx: AppContext): {
    attachUser: (req: FastifyRequest) => Promise<void>;
    requireAuth: (req: FastifyRequest, _reply: FastifyReply) => Promise<void>;
    requirePermission: (...perms: Permission[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
};
//# sourceMappingURL=auth.d.ts.map