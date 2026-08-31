// Point the real Prisma + Redis singletons at the dedicated TEST infix
// (Postgres bothive_test on :5434, Redis on :6379) BEFORE any test module is
// imported. Both connections are created at module scope (packages/api/
// src/services/prisma.ts and queue.ts), so these must be set before imports.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://bothive:bothive_test_pw@127.0.0.1:5434/bothive_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-0123456789abcdef';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key';
