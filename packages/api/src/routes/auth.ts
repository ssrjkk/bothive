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

    const payload = { id: authedUser.id, email: authedUser.email, role: authedUser.role };
    const token = app.jwt.sign(payload, { expiresIn: '24h' });
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

      const payload = { id: user.id, email: user.email, role: user.role };
      const token = app.jwt.sign(payload, { expiresIn: '24h' });
      reply.header('Set-Cookie', buildTokenCookie(token));
      reply.header('Cache-Control', 'no-store');

      return { success: true, data: { token, user: publicUser(user) } };
    },
  );

  app.post('/logout', async (_request, reply) => {
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
      return {
        success: true,
        data: {
          id: fresh!.id,
          email: fresh!.email,
          name: fresh!.name,
          role: fresh!.role,
          createdAt: fresh!.createdAt,
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
      // Revoke all existing JWTs for this user. The requireAuth hook checks
      // this key on every request; fail-open if Redis is unreachable so a
      // transient outage doesn't lock out all users.
      try {
        await redisConnection.set(`revoked:${user.id}`, '1', 'EX', 86400);
      } catch {
        // Redis down: password is changed but old tokens remain valid until
        // they expire. Acceptable degradation — the attacker window is bounded
        // by the JWT expiry (24h).
      }
      return { success: true, message: 'Password updated' };
    },
  );
}
