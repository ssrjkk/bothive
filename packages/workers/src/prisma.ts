import { PrismaClient } from '@prisma/client';

/**
 * One shared PrismaClient for the whole workers process. Platform workers each
 * used to construct their own client, opening a separate Postgres connection
 * pool per worker (plus one for the script engine); with per-platform
 * processes that would multiply connections. A single instance keeps the
 * connection count at one pool and lets Prisma reuse a single pool.
 */
export const prisma = new PrismaClient();
