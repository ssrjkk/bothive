import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Verifies the JWT and re-fetches the user from the database.
 *
 * Re-fetching (instead of trusting the role claim embedded in the JWT) is what
 * makes demotions and deletions take effect immediately: a stale token that
 * still says "admin" is evaluated against the current row, and a token for a
 * deleted user is rejected outright.
 */
async function verifyUser(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  try {
    await request.jwtVerify();
  } catch {
    reply
      .status(401)
      .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return null;
  }
  const token = request.user as { id: string; email: string; role: string };
  const user = await request.prisma.user.findUnique({
    where: { id: token.id },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    reply
      .status(401)
      .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return null;
  }
  return user;
}

/**
 * Shared auth hook: verifies the JWT, re-fetches the user, and enforces
 * role-based access. Roles are read from the database, not the token claim.
 * - admin: full access
 * - viewer: read-only (GET/HEAD/OPTIONS)
 * - anything else / missing token / deleted user: 401 or 403
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await verifyUser(request, reply);
  if (!user) return;
  if (user.role === 'admin') return;
  if (user.role === 'viewer' && !WRITE_METHODS.has(request.method)) return;
  reply
    .status(403)
    .send({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await verifyUser(request, reply);
  if (!user) return;
  if (user.role === 'admin') return;
  reply
    .status(403)
    .send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin role required' } });
}
