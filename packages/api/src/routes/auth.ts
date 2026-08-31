import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { RegisterSchema, LoginSchema, ChangePasswordSchema } from '@bothive/core';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { requireAuth, requireAdmin } from '../utils/auth-hook.js';
import { buildTokenCookie, clearTokenCookie } from '../utils/cookies.js';
import { RedisRateLimiter } from '@bothive/core';
import { redisConnection } from '../services/queue.js';

const loginLimiter = new RedisRateLimiter(redisConnection, 'rl:login', 10, 60_000);
const registerLimiter = new RedisRateLimiter(redisConnection, 'rl:register', 5, 3_600_000);
const passwordLimiter = new RedisRateLimiter(redisConnection, 'rl:password', 5, 60_000);

// Constant-time dummy stored hash so unknown emails take as long to verify as known ones.
const DUMMY_PASSWORD_HASH =
  '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

async function rateLimited(
  limiter: RedisRateLimiter,
  key: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!(await limiter.check(key))) {
    reply.status(429).send({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' },
    });
    return true;
  }
  return false;
}

async function authenticate(
  email: string,
  password: string,
  storedHash: string | undefined,
): Promise<boolean> {
  if (!storedHash) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return false;
  }
  return verifyPassword(password, storedHash);
}

function publicUser(user: { id: string; email: string; name: string | null; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * Current revocation epoch for a user. The auth hook (`requireAuth` /
 * `requireAdmin`) compares the `ver` claim embedded in a JWT against this value
 * and rejects any token whose `ver` is older. Bumping the epoch (password
 * change) revokes every previously issued token immediately, while a fresh
 * login signs a token with the new epoch and stays valid — so changing a
 * password never locks the user out of their next login (the old per-user
 * `revoked:<userId>` flag did, because a new token was also rejected for up to
 * 24h).
 */
async function currentRevocationEpoch(userId: string): Promise<number> {
  try {
    const raw = await redisConnection.get(`revoked:${userId}`);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Redis down: fall back to epoch 0 so all tokens are treated as current.
    return 0;
  }
}

/**
 * Issues a JWT carrying an embedded revocation epoch (`ver`) and a unique
 * session id (`jti`). `jti` lets logout revoke exactly the logged-out token;
 * `ver` lets password change revoke every token for the user at once.
 */
async function issueUserToken(
  app: FastifyInstance,
  user: { id: string; email: string; role: string },
): Promise<string> {
  const epoch = await currentRevocationEpoch(user.id);
  return app.jwt.sign(
    { id: user.id, email: user.email, role: user.role, ver: epoch },
    { expiresIn: '24h', jti: randomUUID() },
  );
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string } }>('/login', async (request, reply) => {
    if (await rateLimited(loginLimiter, request.ip, reply)) return;

    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const { email, password } = parsed.data;
    const user = await request.prisma.user.findUnique({ where: { email } });
    if (!(await authenticate(email, password, user?.passwordHash))) {
      return reply
        .status(401)
        .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
    }
    const authedUser = user!;

    const token = await issueUserToken(app, authedUser);
    reply.header('Set-Cookie', buildTokenCookie(token));
    // The token travels in the response body, so never let proxies or the
    // browser cache it.
    reply.header('Cache-Control', 'no-store');

    return { success: true, data: { token, user: publicUser(authedUser) } };
  });

  app.post<{ Body: { email: string; password: string; name?: string } }>(
    '/register',
    async (request, reply) => {
      if (process.env.ALLOW_REGISTRATION === 'false') {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Registration is disabled' },
        });
      }
      if (await rateLimited(registerLimiter, request.ip, reply)) return;

      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }

      const { email, password, name } = parsed.data;

      // Check-and-create in one serializable transaction so two simultaneous
      // first registrations cannot both pass the "no users yet" check and both
      // become admin. Serializable isolation makes the losing insert fail with a
      // P2034 retry error instead of silently creating a second admin.
      let user: { id: string; email: string; name: string | null; role: string };
      try {
        user = await request.prisma.$transaction(
          async (tx) => {
            const userCount = await tx.user.count();
            if (userCount > 0) {
              const err = new Error(
                'Registration is closed. Contact the administrator.',
              ) as Error & { statusCode: number; code: string };
              err.statusCode = 403;
              err.code = 'FORBIDDEN';
              throw err;
            }
            return tx.user.create({
              data: {
                email,
                passwordHash: await hashPassword(password),
                name: name ?? email.split('@')[0],
                role: 'admin',
              },
            });
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (err) {
        const e = err as Error & { statusCode?: number; code?: string };
        if (e.statusCode === 403) {
          return reply
            .status(403)
            .send({ success: false, error: { code: e.code, message: e.message } });
        }
        if (e.code === 'P2002' || e.code === 'P2034') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'CONFLICT',
              message: 'Email already registered or registration raced',
            },
          });
        }
        throw err;
      }

      const token = await issueUserToken(app, user);
      reply.header('Set-Cookie', buildTokenCookie(token));
      reply.header('Cache-Control', 'no-store');

      return { success: true, data: { token, user: publicUser(user) } };
    },
  );

  app.post('/logout', async (request, reply) => {
    // Revoke just the current session: any existing token for this user is
    // invalidated here, so a compromised cookie is dead after the user logs out
    // instead of staying valid for up to 24h. Other simultaneously-active
    // sessions (different `jti`) are unaffected.
    try {
      await request.jwtVerify();
      const token = request.user as { id: string; jti?: string; exp?: number };
      if (token?.id && token?.jti) {
        const ttl = token.exp
          ? Math.max(1, Math.min(86400, Math.floor(token.exp - Date.now() / 1000)))
          : 86400;
        await redisConnection.set(`revoked:${token.id}:${token.jti}`, '1', 'EX', ttl);
      }
    } catch {
      // Token already invalid/missing; nothing to revoke.
    }
    reply.header('Set-Cookie', clearTokenCookie());
    return { success: true };
  });

  app.get('/me', { onRequest: requireAuth }, async (request, reply) => {
    const payload = request.user as { id: string };
    const user = await request.prisma.user.findUnique({ where: { id: payload.id } });
    if (!user)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    return { success: true, data: publicUser(user) };
  });

  app.get('/users', { onRequest: requireAdmin }, async (request) => {
    const users = await request.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return {
      success: true,
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { role?: string } }>(
    '/users/:id/role',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const role = request.body?.role;
      if (role !== 'admin' && role !== 'viewer') {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'role must be admin or viewer' },
        });
      }
      const target = await request.prisma.user.findUnique({ where: { id: request.params.id } });
      if (!target)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

      // Atomic conditional update: prevents the race where two concurrent demote
      // requests both pass the adminCount check and both succeed, leaving zero admins.
      // The WHERE clause ensures the UPDATE affects 0 rows when it would leave no admins.
      const updated = await request.prisma.$executeRaw`
        UPDATE "User" SET role = ${role}, "updatedAt" = NOW()
        WHERE id = ${request.params.id}
        AND NOT (
          role = 'admin' AND ${role} = 'viewer'
          AND (SELECT COUNT(*) FROM "User" WHERE role = 'admin') <= 1
        )
      `;
      if (updated === 0) {
        return reply.status(409).send({
          success: false,
          error: { code: 'CONFLICT', message: 'Cannot demote the last admin' },
        });
      }
      const fresh = await request.prisma.user.findUnique({ where: { id: request.params.id } });
      if (!fresh) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }
      return {
        success: true,
        data: {
          id: fresh.id,
          email: fresh.email,
          name: fresh.name,
          role: fresh.role,
          createdAt: fresh.createdAt,
        },
      };
    },
  );

  app.post<{ Body: { email: string; password: string; name?: string; role?: string } }>(
    '/users',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      const role = request.body?.role;
      if (role !== undefined && role !== 'admin' && role !== 'viewer') {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'role must be admin or viewer' },
        });
      }

      const existing = await request.prisma.user.findUnique({
        where: { email: parsed.data.email },
      });
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: 'CONFLICT', message: 'Email already registered' },
        });
      }

      const user = await request.prisma.user.create({
        data: {
          email: parsed.data.email,
          passwordHash: await hashPassword(parsed.data.password),
          name: parsed.data.name ?? parsed.data.email.split('@')[0],
          role: role ?? 'viewer',
        },
      });
      return { success: true, data: publicUser(user) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/users/:id',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const me = (request.user as { id: string }).id;
      const target = await request.prisma.user.findUnique({ where: { id: request.params.id } });
      if (!target)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

      if (target.id === me) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'You cannot delete your own account' },
        });
      }

      // Non-admin users can be deleted directly.
      if (target.role !== 'admin') {
        await request.prisma.user.delete({ where: { id: target.id } });
        return { success: true, message: 'User deleted' };
      }

      // Atomic conditional delete: only deletes if at least one OTHER admin
      // remains. Prevents the race where two concurrent deletes both pass the
      // adminCount check and both succeed, leaving zero admins.
      const deleted = await request.prisma.$executeRaw`
        DELETE FROM "User" WHERE id = ${target.id}
        AND (SELECT COUNT(*) FROM "User" WHERE role = 'admin' AND id != ${target.id}) > 0
      `;
      if (deleted === 0) {
        return reply.status(409).send({
          success: false,
          error: { code: 'CONFLICT', message: 'Cannot delete the last admin' },
        });
      }
      return { success: true, message: 'User deleted' };
    },
  );

  app.patch<{ Body: { currentPassword: string; newPassword: string } }>(
    '/password',
    { onRequest: requireAuth },
    async (request, reply) => {
      if (await rateLimited(passwordLimiter, request.ip, reply)) return;

      const parsed = ChangePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }

      const payload = request.user as { id: string };
      const user = await request.prisma.user.findUnique({ where: { id: payload.id } });
      if (!user)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

      if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' },
        });
      }

      await request.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(parsed.data.newPassword) },
      });
      // Bump the user's revocation epoch: every previously issued JWT carries
      // an older `ver` and is rejected by the requireAuth hook. A fresh login
      // reads the new epoch and signs a token with it, so the user is not
      // locked out of their next login (unlike the old per-user flag, which
      // also rejected that next token for up to 24h). Fail-open if Redis is
      // unreachable so a transient outage doesn't lock everyone out.
      try {
        await redisConnection.incr(`revoked:${user.id}`);
      } catch {
        // Redis down: old tokens remain valid until they expire. Acceptable
        // degradation — the attacker window is bounded by the JWT expiry (24h).
      }
      return { success: true, message: 'Password updated' };
    },
  );

  // --- Invitation system ---------------------------------------------------
  //
  // Admins create invite tokens that new users can redeem to set their own
  // password.  This is the preferred onboarding flow for multi-user deployments
  // because the admin never sees or handles user passwords.

  app.post<{ Body: { email: string; role?: string } }>(
    '/invites',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const { email, role } = request.body ?? {};
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid email is required' },
        });
      }
      const inviteRole = role === 'admin' ? 'admin' : 'viewer';

      // Check for an existing unused invite for this email.
      const existing = await request.prisma.invite.findFirst({
        where: { email: email.toLowerCase(), usedAt: null },
      });
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: 'CONFLICT', message: 'An active invite already exists for this email' },
        });
      }

      // Check that the email is not already registered.
      const userExists = await request.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (userExists) {
        return reply.status(409).send({
          success: false,
          error: { code: 'CONFLICT', message: 'Email is already registered' },
        });
      }

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invite = await request.prisma.invite.create({
        data: {
          email: email.toLowerCase(),
          token,
          role: inviteRole,
          createdById: (request.user as { id: string }).id,
          expiresAt,
        },
      });

      return {
        success: true,
        data: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          token: invite.token,
          expiresAt: invite.expiresAt,
          redeemUrl: `/invite/${invite.token}`,
        },
      };
    },
  );

  app.get('/', { onRequest: requireAdmin }, async (request) => {
    const invites = await request.prisma.invite.findMany({
      where: { usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    });
    return { success: true, data: invites };
  });

  app.delete<{ Params: { id: string } }>(
    '/invites/:id',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const deleted = await request.prisma.invite.deleteMany({
        where: { id: request.params.id, usedAt: null },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invite not found or already used' },
        });
      }
      return { success: true, message: 'Invite revoked' };
    },
  );

  app.post<{ Body: { token: string; password: string; name?: string } }>(
    '/invite/redeem',
    async (request, reply) => {
      const { token, password, name } = request.body ?? {};
      if (!token || !password || typeof token !== 'string' || typeof password !== 'string') {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'token and password are required' },
        });
      }

      const invite = await request.prisma.invite.findUnique({ where: { token } });
      if (!invite) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invalid invite token' },
        });
      }
      if (invite.usedAt) {
        return reply.status(410).send({
          success: false,
          error: { code: 'GONE', message: 'Invite has already been used' },
        });
      }
      if (new Date() > invite.expiresAt) {
        return reply.status(410).send({
          success: false,
          error: { code: 'GONE', message: 'Invite has expired' },
        });
      }

      // Create the user and mark the invite as used in a transaction.
      const user = await request.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: invite.email,
            passwordHash: await hashPassword(password),
            name: name ?? invite.email.split('@')[0],
            role: invite.role,
          },
        });
        await tx.invite.update({
          where: { id: invite.id },
          data: { usedAt: new Date() },
        });
        return u;
      });

      const tokenJwt = await issueUserToken(app, user);
      reply.header('Set-Cookie', buildTokenCookie(tokenJwt));
      reply.header('Cache-Control', 'no-store');

      return { success: true, data: { token: tokenJwt, user: publicUser(user) } };
    },
  );
}
