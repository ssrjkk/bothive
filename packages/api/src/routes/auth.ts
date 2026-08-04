import type { FastifyInstance } from 'fastify';
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
const DUMMY_PASSWORD_HASH = '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

async function rateLimited(limiter: RedisRateLimiter, key: string, reply: any): Promise<boolean> {
  if (!(await limiter.check(key))) {
    reply.status(429).send({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } });
    return true;
  }
  return false;
}

function authenticate(email: string, password: string, storedHash: string | undefined): boolean {
  if (!storedHash) {
    verifyPassword(password, DUMMY_PASSWORD_HASH);
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
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });
    }

    const { email, password } = parsed.data;
    const user = await request.prisma.user.findUnique({ where: { email } });
    if (!authenticate(email, password, user?.passwordHash)) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
    }
    const authedUser = user!;

    const payload = { id: authedUser.id, email: authedUser.email, role: authedUser.role };
    const token = app.jwt.sign(payload, { expiresIn: '24h' });
    reply.header('Set-Cookie', buildTokenCookie(token));

    return { success: true, data: { token, user: publicUser(authedUser) } };
  });

  app.post<{ Body: { email: string; password: string; name?: string } }>('/register', async (request, reply) => {
    if (process.env.ALLOW_REGISTRATION === 'false') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Registration is disabled' } });
    }
    if (await rateLimited(registerLimiter, request.ip, reply)) return;

    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });
    }

    const { email, password, name } = parsed.data;

    const userCount = await request.prisma.user.count();
    if (userCount > 0) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Registration is closed. Contact the administrator.' } });
    }

    const existing = await request.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: 'Email already registered' } });
    }

    const user = await request.prisma.user.create({
      data: { email, passwordHash: hashPassword(password), name: name ?? email.split('@')[0], role: 'admin' },
    });

    const payload = { id: user.id, email: user.email, role: user.role };
    const token = app.jwt.sign(payload, { expiresIn: '24h' });
    reply.header('Set-Cookie', buildTokenCookie(token));

    return { success: true, data: { token, user: publicUser(user) } };
  });

  app.post('/logout', async (_request, reply) => {
    reply.header('Set-Cookie', clearTokenCookie());
    return { success: true };
  });

  app.get('/me', { onRequest: requireAuth }, async (request, reply) => {
    const payload = request.user as { id: string };
    const user = await request.prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    return { success: true, data: publicUser(user) };
  });

  app.get('/users', { onRequest: requireAdmin }, async (request) => {
    const users = await request.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return { success: true, data: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt })) };
  });

  app.patch<{ Params: { id: string }; Body: { role?: string } }>('/users/:id/role', { onRequest: requireAdmin }, async (request, reply) => {
    const role = request.body?.role;
    if (role !== 'admin' && role !== 'viewer') {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'role must be admin or viewer' } });
    }
    const target = await request.prisma.user.findUnique({ where: { id: request.params.id } });
    if (!target) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

    const adminCount = await request.prisma.user.count({ where: { role: 'admin' } });
    if (target.role === 'admin' && role === 'viewer' && adminCount <= 1) {
      return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: 'Cannot demote the last admin' } });
    }

    const updated = await request.prisma.user.update({ where: { id: request.params.id }, data: { role } });
    return { success: true, data: { id: updated.id, email: updated.email, name: updated.name, role: updated.role, createdAt: updated.createdAt } };
  });

  app.patch<{ Body: { currentPassword: string; newPassword: string } }>('/password', { onRequest: requireAuth }, async (request, reply) => {
    if (await rateLimited(passwordLimiter, request.ip, reply)) return;

    const parsed = ChangePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });
    }

    const payload = request.user as { id: string };
    const user = await request.prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

    if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
    }

    await request.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(parsed.data.newPassword) },
    });
    return { success: true, message: 'Password updated' };
  });
}
