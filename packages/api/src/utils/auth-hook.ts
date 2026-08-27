import type { FastifyReply, FastifyRequest } from 'fastify';
import { redisConnection } from '../services/queue.js';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The minimal shape of a verified JWT payload needed by the revocation check.
 * `ver` is the user's revocation epoch at issuance; `jti` uniquely identifies
 * the issued token (both set by `issueUserToken` in routes/auth.ts).
 */
export interface RevocableToken {
  id: string;
  ver?: number;
  jti?: string;
}

/**
 * Shared revocation check used by both the REST hooks and the WebSocket log
 * stream, so a session invalidated by logout or password change is rejected
 * everywhere, not just on HTTP requests.
 *
 * Two independent signals:
 *  - `revoked:<userId>:<jti>` set by logout -> kills exactly that one session.
 *  - `revoked:<userId>` epoch bumped by password change -> every older `ver` is
 *    stale (revoke-all) without locking out the next login.
 *
 * Fail-open on a Redis outage (return false = not revoked) so a transient
 * blip never locks every user out. The attacker window is bounded by the JWT
 * expiry (24h). Callers must already have verified the JWT signature + that
 * the user row still exists.
 */
export async function isTokenRevoked(
  redis: { get: (key: string) => Promise<string | null> },
  token: RevocableToken,
): Promise<boolean> {
  try {
    const [epochRaw, jtiRevoked] = await Promise.all([
      redis.get(`revoked:${token.id}`),
      token.jti ? redis.get(`revoked:${token.id}:${token.jti}`) : undefined,
    ]);
    const currentEpoch = Number.isFinite(Number(epochRaw)) ? Number(epochRaw) : 0;
    const staleVersion = (token.ver ?? 0) < currentEpoch;
    return Boolean(jtiRevoked) || staleVersion;
  } catch {
    return false;
  }
}

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
  const token = request.user as { id: string; email: string; role: string; ver?: number; jti?: string };

  // Revocation is checked two ways: per-token (logout) and per-user epoch
  // (password change). Fail-open on Redis outage.
  if (await isTokenRevoked(redisConnection, token)) {
    reply
      .status(401)
      .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token revoked' } });
    return null;
  }

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
