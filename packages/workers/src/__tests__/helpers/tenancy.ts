import { prisma } from '../../prisma.js';

/**
 * Shared tenant id used across worker tests that create Account/Bot rows
 * against the real Postgres test database. Owner-scoping now requires every
 * Account/Bot/Webhook to reference an existing user, so tests that set up
 * fixture rows must ensure this owner exists and stamp `ownerId: TEST_OWNER_ID`.
 */
export const TEST_OWNER_ID = 'test-owner';

export async function ensureTestUser(): Promise<string> {
  await prisma.user.upsert({
    where: { id: TEST_OWNER_ID },
    update: {},
    create: {
      id: TEST_OWNER_ID,
      email: 'owner@test.local',
      passwordHash: '!test!',
      name: 'Test Owner',
      role: 'admin',
    },
  });
  return TEST_OWNER_ID;
}
