import type { FastifyInstance } from 'fastify';
import {
  ScriptTriggerSchema,
  BotConfigSchema,
  validateScriptConfig,
  ensureEncrypted,
} from '@bothive/core';
import { withTimeout } from '../utils/query.js';
import { requireAdmin } from '../utils/auth-hook.js';
import { notifyScriptsChanged } from '../services/script-events.js';

const MAX_ACCOUNTS = 1000;
const MAX_BOTS = 5000;
const MAX_SCRIPTS = 5000;
const MAX_NAME_LENGTH = 100;

interface ImportAccount {
  name: string;
  platform: string;
  token?: string | null;
  clientId?: string | null;
  secret?: string | null;
  refreshToken?: string | null;
  apiKey?: string | null;
}

interface ImportBot {
  name: string;
  platform: string;
  accountRef: number;
  config?: unknown;
}

interface ImportScript {
  botRef: number;
  name: string;
  trigger: string;
  config?: unknown;
  enabled?: boolean;
}

interface ImportPayload {
  version?: number;
  accounts: ImportAccount[];
  bots: ImportBot[];
  scripts: ImportScript[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Builds credential update data, skipping fields absent from the backup so an
 *  import cannot wipe credentials the payload does not mention. Explicit nulls
 *  still clear the stored value. */
function credentialsData(a: ImportAccount): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (a.token !== undefined) data.token = ensureEncrypted(a.token);
  if (a.clientId !== undefined) data.clientId = ensureEncrypted(a.clientId);
  if (a.secret !== undefined) data.secret = ensureEncrypted(a.secret);
  if (a.refreshToken !== undefined) data.refreshToken = ensureEncrypted(a.refreshToken);
  if (a.apiKey !== undefined) data.apiKey = ensureEncrypted(a.apiKey);
  return data;
}

class ImportError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

function validateImport(
  payload: unknown,
): { ok: true; value: ImportPayload } | { ok: false; details: string } {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.accounts) ||
    !Array.isArray(payload.bots) ||
    !Array.isArray(payload.scripts)
  ) {
    return { ok: false, details: 'payload must contain accounts, bots and scripts arrays' };
  }
  // Backups are forward-versioned so a newer format cannot be silently
  // mis-imported as an older one. A missing version is tolerated for legacy
  // exports from before the field existed.
  if (payload.version !== undefined && payload.version !== 1) {
    return {
      ok: false,
      details: `unsupported backup version ${String(payload.version)} (expected 1)`,
    };
  }
  const accounts = payload.accounts as unknown[];
  const bots = payload.bots as unknown[];
  const scripts = payload.scripts as unknown[];

  if (accounts.length > MAX_ACCOUNTS)
    return { ok: false, details: `too many accounts (max ${MAX_ACCOUNTS})` };
  if (bots.length > MAX_BOTS) return { ok: false, details: `too many bots (max ${MAX_BOTS})` };
  if (scripts.length > MAX_SCRIPTS)
    return { ok: false, details: `too many scripts (max ${MAX_SCRIPTS})` };

  for (const a of accounts) {
    if (
      !isRecord(a) ||
      typeof a.name !== 'string' ||
      typeof a.platform !== 'string' ||
      a.name.length === 0 ||
      a.name.length > MAX_NAME_LENGTH
    ) {
      return { ok: false, details: 'each account needs a name and platform (name 1-100 chars)' };
    }
  }
  for (const b of bots) {
    if (
      !isRecord(b) ||
      typeof b.name !== 'string' ||
      typeof b.platform !== 'string' ||
      b.name.length === 0 ||
      b.name.length > MAX_NAME_LENGTH ||
      typeof b.accountRef !== 'number' ||
      b.accountRef < 0 ||
      b.accountRef >= accounts.length
    ) {
      return { ok: false, details: 'each bot needs a name, platform and valid accountRef' };
    }
    if (b.config !== undefined && !BotConfigSchema.safeParse(b.config).success) {
      return { ok: false, details: `bot "${b.name}" has an invalid config` };
    }
  }
  for (const s of scripts) {
    if (
      !isRecord(s) ||
      typeof s.name !== 'string' ||
      typeof s.trigger !== 'string' ||
      s.name.length === 0 ||
      s.name.length > MAX_NAME_LENGTH ||
      typeof s.botRef !== 'number' ||
      s.botRef < 0 ||
      s.botRef >= bots.length
    ) {
      return { ok: false, details: 'each script needs a name, trigger and valid botRef' };
    }
    if (!ScriptTriggerSchema.safeParse(s.trigger).success) {
      return { ok: false, details: `script "${s.name}" has unsupported trigger "${s.trigger}"` };
    }
    const configErrors = validateScriptConfig(s.config ?? {});
    if (configErrors.length > 0) {
      return {
        ok: false,
        details: `script "${s.name}" has an unsafe config: ${configErrors.join('; ')}`,
      };
    }
  }
  return { ok: true, value: payload as unknown as ImportPayload };
}

export async function backupRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAdmin);

  app.get('/export', async (request) => {
    const [accounts, bots, scripts] = await withTimeout(
      Promise.all([
        request.prisma.account.findMany({ orderBy: { createdAt: 'asc' } }),
        request.prisma.bot.findMany({ orderBy: { createdAt: 'asc' } }),
        request.prisma.script.findMany({ orderBy: { createdAt: 'asc' } }),
      ]),
      10_000,
      'Backup export timed out',
    );

    const accountIndex = new Map<string, number>();
    accounts.forEach((a, i) => accountIndex.set(a.id, i));
    const botIndex = new Map<string, number>();
    bots.forEach((b, i) => botIndex.set(b.id, i));

    const data = {
      version: 1,
      app: 'bothive',
      exportedAt: new Date().toISOString(),
      accounts: accounts.map((a) => ({
        name: a.name,
        platform: a.platform,
        token: a.token,
        clientId: a.clientId,
        secret: a.secret,
        refreshToken: a.refreshToken,
        apiKey: a.apiKey,
      })),
      bots: bots.map((b) => ({
        name: b.name,
        platform: b.platform,
        accountRef: accountIndex.get(b.accountId),
        config: b.config ?? {},
      })),
      scripts: scripts.map((s) => ({
        botRef: botIndex.get(s.botId),
        name: s.name,
        trigger: s.trigger,
        config: s.config ?? {},
        enabled: s.enabled,
      })),
    };
    return { success: true, data };
  });

  app.post('/import', async (request, reply) => {
    const parsed = validateImport(request.body);
    if (!parsed.ok) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid backup payload',
          details: { payload: parsed.details },
        },
      });
    }

    const { accounts, bots, scripts } = parsed.value;

    try {
      // Run the whole import in one transaction so a mid-import failure rolls
      // back instead of leaving a partially restored database.
      const stats = await request.prisma.$transaction(async (tx) => {
        let accountsCreated = 0;
        let accountsUpdated = 0;
        const accountIdByRef: (string | undefined)[] = [];

        for (const a of accounts) {
          const credentials = credentialsData(a);
          const candidates = await tx.account.findMany({ where: { platform: a.platform } });
          const existing = candidates.find((c) => c.name === a.name);
          if (existing) {
            await tx.account.update({ where: { id: existing.id }, data: credentials });
            accountsUpdated += 1;
            accountIdByRef.push(existing.id);
          } else {
            const created = await tx.account.create({
              data: { name: a.name, platform: a.platform, ...credentials },
            });
            accountsCreated += 1;
            accountIdByRef.push(created.id);
          }
        }

        let botsCreated = 0;
        let botsUpdated = 0;
        const botIdByRef: (string | undefined)[] = [];

        for (const b of bots) {
          const accountId = accountIdByRef[b.accountRef];
          if (!accountId)
            throw new ImportError('Could not resolve account for bot', { bot: b.name });
          const candidates = await tx.bot.findMany({ where: { accountId } });
          const existing = candidates.find((c) => c.name === b.name);
          if (existing) {
            await tx.bot.update({
              where: { id: existing.id },
              data: { config: (b.config ?? {}) as object },
            });
            botsUpdated += 1;
            botIdByRef.push(existing.id);
          } else {
            const created = await tx.bot.create({
              data: {
                name: b.name,
                platform: b.platform,
                accountId,
                config: (b.config ?? {}) as object,
              },
            });
            botsCreated += 1;
            botIdByRef.push(created.id);
          }
        }

        let scriptsCreated = 0;
        let scriptsUpdated = 0;

        for (const s of scripts) {
          const botId = botIdByRef[s.botRef];
          if (!botId) throw new ImportError('Could not resolve bot for script', { script: s.name });
          const existing = await tx.script
            .findMany({ where: { botId } })
            .then((rows) => rows.find((r) => r.name === s.name));
          if (existing) {
            await tx.script.update({
              where: { id: existing.id },
              data: {
                trigger: s.trigger,
                config: (s.config ?? {}) as object,
                enabled: s.enabled ?? true,
              },
            });
            scriptsUpdated += 1;
          } else {
            await tx.script.create({
              data: {
                botId,
                name: s.name,
                trigger: s.trigger,
                config: (s.config ?? {}) as object,
                enabled: s.enabled ?? true,
              },
            });
            scriptsCreated += 1;
          }
        }

        return {
          accounts: { created: accountsCreated, updated: accountsUpdated },
          bots: { created: botsCreated, updated: botsUpdated },
          scripts: { created: scriptsCreated, updated: scriptsUpdated },
        };
      });

      // Imported scripts won't reach the workers until they reload, so nudge
      // them through the same pub/sub channel the scripts routes use.
      if (stats.scripts.created > 0 || stats.scripts.updated > 0) {
        notifyScriptsChanged();
      }

      return { success: true, data: stats };
    } catch (err) {
      if (err instanceof ImportError) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: err.message, details: err.details },
        });
      }
      throw err;
    }
  });
}
