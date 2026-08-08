import { vi } from 'vitest';

interface Where {
  [key: string]: unknown;
}

interface DbRecord {
  id: string;
  [key: string]: unknown;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function matches(record: DbRecord, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, val] of Object.entries(where)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const op = val as Record<string, unknown>;
      if ('in' in op && Array.isArray(op.in)) {
        if (!op.in.includes(record[key])) return false;
        continue;
      }
      if ('contains' in op) {
        const needle = String(op.contains ?? '');
        const haystack = String(record[key] ?? '');
        if (op.mode === 'insensitive') {
          if (!haystack.toLowerCase().includes(needle.toLowerCase())) return false;
        } else if (!haystack.includes(needle)) {
          return false;
        }
        continue;
      }
      if ('gte' in op || 'lte' in op || 'gt' in op || 'lt' in op) {
        const rv = new Date(record[key] as string).getTime();
        const cmp = (opts: string) => new Date(op[opts] as string).getTime();
        if ('gte' in op && !(rv >= cmp('gte'))) return false;
        if ('lte' in op && !(rv <= cmp('lte'))) return false;
        if ('gt' in op && !(rv > cmp('gt'))) return false;
        if ('lt' in op && !(rv < cmp('lt'))) return false;
        continue;
      }
      if (!deepEqual(val, record[key])) return false;
      continue;
    }
    if (record[key] !== val) return false;
  }
  return true;
}

function project(record: DbRecord, select?: Record<string, boolean>): DbRecord {
  if (!select) return record;
  const out: DbRecord = { id: record.id };
  for (const key of Object.keys(select)) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}

export interface MockDb {
  prisma: Record<string, unknown>;
  seed: (model: string, records: DbRecord[]) => void;
  reset: () => void;
}

export function createMockDb(): MockDb {
  const state: Record<string, DbRecord[]> = { user: [], bot: [], account: [], script: [], log: [], webhook: [] };

  const now = () => new Date().toISOString();

  const applyInclude = (record: DbRecord, include?: Record<string, unknown>): DbRecord => {
    if (!include) return record;
    const out: DbRecord = { ...record };
    if (include.account) {
      const acc = state.account.find((a) => a.id === record.accountId);
      const spec = include.account as Record<string, unknown>;
      out.account = acc ? project(acc, spec.select as Record<string, boolean>) : null;
    }
    if (include.scripts) {
      const spec = include.scripts as Record<string, unknown>;
      const scripts = state.script.filter((s) => s.botId === record.id);
      out.scripts = spec.select ? scripts.map((s) => project(s, spec.select as Record<string, boolean>)) : scripts;
    }
    if (include.logs) {
      const spec = include.logs as Record<string, unknown>;
      const take = (spec.take as number) ?? 50;
      out.logs = state.log
        .filter((l) => l.botId === record.id)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())
        .slice(0, take);
    }
    if (include._count) {
      const count: Record<string, number> = {};
      const spec = include._count as Record<string, unknown>;
      const select = (spec.select as Record<string, boolean>) ?? {};
      for (const rel of Object.keys(select)) {
        const relRecords = state[rel] ?? [];
        count[rel] = relRecords.filter((r) => r.botId === record.id).length;
      }
      out._count = count;
    }
    return out;
  };

  const makeModel = (name: string) => ({
    findUnique: vi.fn(async (args: { where: Where; include?: Record<string, unknown>; select?: Record<string, boolean> } = { where: {} }) => {
      const key = Object.keys(args.where)[0];
      const rec = state[name].find((r) => r[key] === args.where[key]);
      if (!rec) return null;
      return project(applyInclude(rec, args.include), args.select);
    }),
    findMany: vi.fn(async (args: { where?: Where; include?: Record<string, unknown>; select?: Record<string, boolean>; orderBy?: Record<string, string>; take?: number; skip?: number } = {}) => {
      let rows = state[name].filter((r) => matches(r, args.where));
      if (args.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0];
        rows = [...rows].sort((a, b) => {
          const av = new Date(a[field] as string).getTime();
          const bv = new Date(b[field] as string).getTime();
          return dir === 'desc' ? bv - av : av - bv;
        });
      }
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return rows.map((r) => applyInclude(r, args.include));
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const rec: DbRecord = { id: Math.random().toString(36).slice(2, 12), createdAt: now(), updatedAt: now(), ...args.data } as DbRecord;
      state[name].push(rec);
      return rec;
    }),
    update: vi.fn(async (args: { where: Where; data: Record<string, unknown> }) => {
      const key = Object.keys(args.where)[0];
      const idx = state[name].findIndex((r) => r[key] === args.where[key]);
      if (idx === -1) throw new Error(`${name} not found`);
      state[name][idx] = { ...state[name][idx], ...args.data, updatedAt: now() };
      return state[name][idx];
    }),
    updateMany: vi.fn(async (args: { where?: Where; data: Record<string, unknown> }) => {
      const rows = state[name].filter((r) => matches(r, args.where));
      for (const r of rows) Object.assign(r, args.data, { updatedAt: now() });
      return { count: rows.length };
    }),
    delete: vi.fn(async (args: { where: Where }) => {
      const key = Object.keys(args.where)[0];
      const before = state[name].length;
      state[name] = state[name].filter((r) => r[key] !== args.where[key]);
      return { deleted: before - state[name].length };
    }),
    deleteMany: vi.fn(async (args: { where?: Where } = {}) => {
      const before = state[name].length;
      state[name] = state[name].filter((r) => !matches(r, args.where));
      return { count: before - state[name].length };
    }),
    count: vi.fn(async (args: { where?: Where } = {}) => state[name].filter((r) => matches(r, args.where)).length),
    groupBy: vi.fn(async (args: { by: string[]; _count?: Record<string, unknown> }) => {
      const field = args.by[0];
      const counts = new Map<unknown, number>();
      for (const r of state[name]) {
        counts.set(r[field], (counts.get(r[field]) ?? 0) + 1);
      }
      return [...counts.entries()].map(([k, n]) => ({ [field]: k, _count: { id: n } }));
    }),
  });

  const prisma = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => {
      if (prop === '$queryRaw') return async () => [{ '?column?': 1 }];
      if (prop === '$disconnect') return async () => undefined;
      if (prop === '$connect') return async () => undefined;
      if (prop === '$transaction') {
        return (arg: unknown) =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (p: unknown) => Promise<unknown>)(prisma);
      }
      return makeModel(String(prop));
    },
  });

  return {
    prisma,
    seed: (model: string, records: DbRecord[]) => {
      state[model] = records;
    },
    reset: () => {
      for (const key of Object.keys(state)) state[key] = [];
    },
  };
}
