import type { FastifyRequest, FastifyReply } from 'fastify';

export interface OwnerScoped {
  ownerId: string;
}

/**
 * Returns the authenticated user's id to use as the tenant/owner scope for all
 * resource queries. Callers must already have run `requireAuth` (which
 * guarantees `request.user.id` is the verified, DB-fetched user identity).
 */
export function requestOwnerId(request: FastifyRequest): string {
  const user = request.user as { id?: string };
  return user?.id ?? '';
}

/**
 * A compact 404 shaper shared by scoped find/update failures so every
 * owner-scoped route reports the same body (an existing-but-not-owned row is
 * indistinguishable from a missing row — no existence leakage).
 */
export function sendNotFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Resource not found' },
  });
}

export interface ScopeFilter {
  ownerId: string;
}

export interface UniqueScope extends ScopeFilter {
  id: string;
}

/**
 * Builds the `where` clause scoped to a single owner for unique lookups.
 * Ownership is enforced in the query (missing row and foreign row both return
 * nothing below), so no extra existence round-trip is needed to prevent an
 * owner from reading/writing another owner's row.
 */
export function ownerScopedUnique(ownerId: string, id: string): UniqueScope {
  return { id, ownerId };
}

export function ownerScopedWhere(
  ownerId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ownerId, ...extra };
}
