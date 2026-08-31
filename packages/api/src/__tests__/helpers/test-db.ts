import { prisma } from '../../services/prisma.js';
import { flushAll } from './test-redis.js';

// Mock-db replacement: a thin controller over the REAL Prisma client bound to
// the test Postgres. The app's `buildApp()` decorates this same singleton from
// ../services/prisma.js, so seeding here is visible to the routes under test,
// and reset() truncates the shared tables between tests.
//
// The old in-memory mock never enforced foreign keys, so many tests seed e.g. a
// `bot` without first seeding its referenced `account`. Real Postgres enforces
// `Bot.accountId -> Account.id` (and `Log/Script/Webhook -> Bot`), so the seed
// helper auto-creates the smallest possible parent stub for any missing
// referenced row, preserving the mock's permissive behaviour against a real DB.

// Owner (tenant) id used as the default for directly-seeded owner-scoped rows.
// The API tests authenticate as user "u1" in the vast majority of cases, so a
// row they seed directly must belong to that same user to be visible through
// the now owner-scoped routes.
const TEST_OWNER_ID = 'u1';

const MODEL_TABLES = [
  '"User"',
  '"Invite"',
  '"Bot"',
  '"Log"',
  '"Script"',
  '"Webhook"',
  '"WebhookDelivery"',
  '"Proxy"',
  '"Account"',
];

// Lowercase Prisma delegate name -> children that cascade-reference it (so they
// can be cleared first to avoid FK violations when a model's rows are replaced).
const DEPS: Record<string, string[]> = {
  user: [],
  bot: ['log', 'script', 'webhook', 'webhookDelivery'],
  account: ['bot'],
  log: [],
  script: [],
  webhook: ['webhookDelivery'],
  proxy: [],
};

type Delegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  deleteMany: (args?: unknown) => Promise<unknown>;
  createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  upsert: (args: {
    where: { id: string };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }) => Promise<unknown>;
};

// child model -> its parent FK(s).
const PARENT_FKS: Record<string, Array<{ field: string; parent: string }>> = {
  bot: [{ field: 'accountId', parent: 'account' }],
  log: [{ field: 'botId', parent: 'bot' }],
  script: [{ field: 'botId', parent: 'bot' }],
  webhook: [{ field: 'botId', parent: 'bot' }],
  webhookDelivery: [{ field: 'webhookId', parent: 'webhook' }],
};

// Minimal row stub for a missing parent. Its FK fields (if any) become stub
// child ids resolved recursively by `ensure`.
function stub(model: string, id: string): Record<string, unknown> {
  switch (model) {
    case 'user':
      return {
        id,
        email: `user-${id}@bothive.test`,
        passwordHash: '!stub!',
        name: id,
        role: 'viewer',
      };
    case 'account':
      return { id, name: '', platform: 'stub', ownerId: TEST_OWNER_ID };
    case 'bot':
      return {
        id,
        name: id,
        platform: 'stub',
        accountId: `${id}-acc`,
        status: 'idle',
        config: {},
        ownerId: TEST_OWNER_ID,
      };
    case 'log':
      return { id, botId: `${id}-bot`, level: 'info', message: '' };
    case 'script':
      return { id, botId: `${id}-bot`, name: id, trigger: 'message', config: {} };
    case 'webhook':
      return { id, name: id, url: 'http://localhost:1', events: [], ownerId: TEST_OWNER_ID };
    case 'webhookDelivery':
      return { id, webhookId: `${id}-wh`, eventType: 'x', status: 'ok' };
    default:
      return { id };
  }
}

export interface TestDb {
  prisma: typeof prisma;
  seed: (model: string, records: Array<Record<string, unknown>>) => Promise<void>;
  reset: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  function delegate(model: string): Delegate {
    const d = (prisma as unknown as Record<string, unknown>)[model];
    if (!d || typeof (d as Delegate).createMany !== 'function') {
      throw new Error(`Unknown model for real test-db seed: ${model}`);
    }
    return d as Delegate;
  }

  async function ensure(model: string, id: string): Promise<void> {
    if (!id) return;
    const d = delegate(model);
    if (await d.findUnique({ where: { id } })) return;
    const row = stub(model, id);
    // Owner-scoped rows need the owning user to exist before the FK will
    // accept them; the user stub is a valid, standalone row.
    if (model === 'account' || model === 'bot' || model === 'webhook') {
      const ownerId = String(row.ownerId ?? '');
      if (ownerId) await ensure('user', ownerId);
    }
    for (const { field, parent } of PARENT_FKS[model] ?? []) {
      const pid = String(row[field] ?? '');
      if (pid) await ensure(parent, pid);
    }
    await d.create({ data: row }).catch(() => {});
  }

  async function ensureParents(
    model: string,
    records: Array<Record<string, unknown>>,
  ): Promise<void> {
    const fks = PARENT_FKS[model] ?? [];
    if (!fks.length) return;
    for (const rec of records) {
      for (const { field, parent } of fks) {
        const pid = rec[field];
        if (typeof pid === 'string' && pid) await ensure(parent, pid);
      }
    }
  }

  // Owner-scoped models now require a FK to a User. Default a missing ownerId
  // to the canonical test owner and make sure that user row exists so a bare
  // `seed('account' | 'bot' | 'webhook', [...])` works without the caller
  // having to pre-seed a user.
  async function normalizeOwner(
    model: string,
    records: Array<Record<string, unknown>>,
  ): Promise<void> {
    if (model !== 'account' && model !== 'bot' && model !== 'webhook') return;
    await ensure('user', TEST_OWNER_ID);
    for (const rec of records) {
      if (rec.ownerId === undefined || rec.ownerId === null) rec.ownerId = TEST_OWNER_ID;
    }
  }

  return {
    prisma,
    seed: async (model: string, records: Array<Record<string, unknown>>) => {
      // User seeding must UPSERT (not wipe-and-recreate): the owner FK on
      // Account/Bot/Webhook cascade-deletes their rows when a user is deleted,
      // so clearing + re-inserting the user on every `seed('user', [...])`
      // would destroy resources the same owner created earlier in the test
      // (via direct seed or through the API before a later `authed()` call).
      if (model === 'user') {
        const d = delegate(model);
        for (const rec of records) {
          const id = String(rec.id ?? '');
          if (!id) throw new Error('seed(user) requires an id');
          const update = { ...rec };
          delete (update as { id?: unknown }).id;
          await d.upsert({ where: { id }, update, create: rec });
        }
        return;
      }
      const deps = DEPS[model] ?? [];
      for (const dep of deps) {
        const d = (prisma as unknown as Record<string, unknown>)[dep];
        await (d as Delegate | undefined)?.deleteMany({}).catch(() => {});
      }
      await normalizeOwner(model, records);
      await ensureParents(model, records);
      const d = delegate(model);
      await d.deleteMany({});
      if (records.length) await d.createMany({ data: records });
    },
    reset: async () => {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${MODEL_TABLES.join(', ')} CASCADE`);
      // The API package owns the real Redis (BullMQ queues, memory, script
      // events, rate-limit counters, revocation epochs). Flush it between tests
      // so no keyspace from a previous test leaks into the next one. The test
      // Redis is a dedicated container and files run sequentially, so this is
      // safe to do here.
      await flushAll();
    },
  };
}
