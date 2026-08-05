import { sha256Hex, resolvePermissions } from '@nexpanel/shared';
import { ApiError } from '../lib/errors.js';
export async function resolveSession(ctx, token) {
    if (!token || token.length < 20 || token.length > 200)
        return null;
    const tokenHash = sha256Hex(token);
    const session = await ctx.db.session.findUnique({
        where: { tokenHash },
        include: { user: true },
    });
    if (!session)
        return null;
    if (session.expiresAt.getTime() < Date.now()) {
        await ctx.db.session.delete({ where: { id: session.id } }).catch(() => undefined);
        return null;
    }
    // Sliding session: touch at most once per minute to avoid write amplification.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
        await ctx.db.session
            .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
            .catch(() => undefined);
    }
    const u = session.user;
    return {
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        permissions: resolvePermissions(u.role, u.grantedPermissions, u.revokedPermissions),
        sessionId: session.id,
    };
}
export function makeAuthHooks(ctx) {
    /** Populates request.authedUser from the session cookie (never throws). */
    async function attachUser(req) {
        const token = req.cookies[ctx.config.cookieName];
        req.authedUser = await resolveSession(ctx, token);
    }
    /** Requires a valid session; on mutating methods also enforces the CSRF header. */
    async function requireAuth(req, _reply) {
        if (!req.authedUser)
            throw ApiError.unauthorized();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (req.headers['x-nexpanel-csrf'] !== '1') {
                throw ApiError.forbidden('Missing CSRF header');
            }
        }
    }
    function requirePermission(...perms) {
        return async (req, reply) => {
            await requireAuth(req, reply);
            const user = req.authedUser;
            for (const p of perms) {
                if (!user.permissions.has(p)) {
                    throw ApiError.forbidden(`Missing permission: ${p}`);
                }
            }
        };
    }
    return { attachUser, requireAuth, requirePermission };
}
//# sourceMappingURL=auth.js.map