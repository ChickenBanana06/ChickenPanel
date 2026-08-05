import type { FastifyInstance } from 'fastify';
import { RegisterSchema, LoginSchema, newSecretToken, sha256Hex } from '@nexpanel/shared';
import type { AppContext } from '../context.js';
import { makeAuthHooks } from '../plugins/auth.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { requireAuth } = makeAuthHooks(ctx);

  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && !process.env.NEXPANEL_INSECURE_COOKIES,
  };

  async function createSession(userId: string, req: { headers: Record<string, unknown>; ip: string }) {
    const token = newSecretToken(32);
    await ctx.db.session.create({
      data: {
        tokenHash: sha256Hex(token),
        userId,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
        ip: req.ip,
        expiresAt: new Date(Date.now() + ctx.config.sessionTtlDays * 86400_000),
      },
    });
    return token;
  }

  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const userCount = await ctx.db.user.count();
    if (userCount > 0) {
      const setting = await ctx.db.setting.findUnique({ where: { key: 'registrationOpen' } });
      if (setting?.value !== true) {
        throw ApiError.forbidden('Registration is disabled. Ask an administrator to create your account.');
      }
    }
    const passwordHash = await hashPassword(body.password);
    let user;
    try {
      user = await ctx.db.user.create({
        data: {
          username: body.username,
          email: body.email.toLowerCase(),
          passwordHash,
          // First account becomes the administrator.
          role: userCount === 0 ? 'ADMIN' : 'USER',
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw ApiError.conflict('Username or email already in use');
      throw err;
    }
    await writeAudit(ctx.db, {
      actor: 'user', userId: user.id, action: 'auth.register', success: true, ip: req.ip,
    });
    const token = await createSession(user.id, req);
    reply.setCookie(ctx.config.cookieName, token, cookieOpts);
    return { user: { id: user.id, username: user.username, email: user.email, role: user.role } };
  });

  app.post('/login', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await ctx.db.user.findFirst({
      where: { OR: [{ username: body.username }, { email: body.username.toLowerCase() }] },
    });
    // Always verify against something to keep timing consistent.
    const ok = await verifyPassword(
      body.password,
      user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvaliuGJ1zBBSlXAJyF8jEfeQW3ZDF6oNi',
    );
    if (!user || !ok) {
      await writeAudit(ctx.db, {
        actor: 'user', userId: user?.id, action: 'auth.login', success: false, error: 'invalid credentials', ip: req.ip,
      });
      throw ApiError.unauthorized('Invalid username or password');
    }
    const token = await createSession(user.id, req);
    reply.setCookie(ctx.config.cookieName, token, cookieOpts);
    await writeAudit(ctx.db, { actor: 'user', userId: user.id, action: 'auth.login', success: true, ip: req.ip });
    return { user: { id: user.id, username: user.username, email: user.email, role: user.role } };
  });

  /** Change your own password. Verifies the current one and signs out other sessions. */
  app.post('/change-password', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) throw ApiError.badRequest('currentPassword and newPassword required');
    if (newPassword.length < 1 || newPassword.length > 256) {
      throw ApiError.badRequest('New password must be at least 1 character');
    }
    const authed = req.authedUser!;
    const user = await ctx.db.user.findUnique({ where: { id: authed.id } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      await writeAudit(ctx.db, {
        actor: 'user', userId: authed.id, action: 'auth.change_password',
        success: false, error: 'wrong current password', ip: req.ip,
      });
      throw ApiError.unauthorized('Current password is incorrect');
    }
    await ctx.db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    // Sign out every other session for this account.
    await ctx.db.session.deleteMany({ where: { userId: user.id, id: { not: authed.sessionId } } });
    await writeAudit(ctx.db, { actor: 'user', userId: user.id, action: 'auth.change_password', success: true, ip: req.ip });
    return { ok: true };
  });

  app.post('/logout', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.authedUser!;
    await ctx.db.session.delete({ where: { id: user.sessionId } }).catch(() => undefined);
    reply.clearCookie(ctx.config.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const user = req.authedUser;
    if (!user) throw ApiError.unauthorized();
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: [...user.permissions],
      },
    };
  });

  app.get('/setup-status', async () => {
    const userCount = await ctx.db.user.count();
    return { needsSetup: userCount === 0 };
  });
}
