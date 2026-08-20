import { config } from 'dotenv';
import type { PlatformEvent } from '@bothive/core';
import { bus, Events, RedisMemoryStore, BotMemory } from '@bothive/core';
import { prisma } from './prisma.js';
import { BaseWorker, WorkerManager, mapLimit } from './base-worker.js';
import { TelegramWorker } from './telegram/worker.js';
import { TwitchWorker } from './twitch/worker.js';
import { YoutubeWorker } from './youtube/worker.js';
import { TwitterWorker } from './twitter/worker.js';
import { CryptoWorker } from './crypto/worker.js';
import { ScriptEngine, ScriptConfig, ScriptApi } from './script-engine.js';
import { publishLog, disconnectLogPublisher } from './log-publisher.js';
import { watchScriptChanges, disconnectScriptSync } from './script-sync.js';
import { startScriptTrigger } from './script-trigger.js';
import { dispatchWebhooks, startWebhookWorker, stopWebhookWorker } from './webhooks.js';
import { startWorkerHeartbeat } from './heartbeat.js';
import { validateWorkerSecrets, fetchWithGuard, initSentry, shutdownTracing } from '@bothive/core';

config();

initSentry({ service: 'workers' });

validateWorkerSecrets();

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const scriptEngine = new ScriptEngine();
const memoryStore = new RedisMemoryStore(redisUrl);
const botMemory = new BotMemory(memoryStore);

const INTERVAL_POLL_MS = Number(process.env.INTERVAL_POLL_MS ?? 30_000);
const INTERVAL_DISPATCH_CONCURRENCY = 5;

/**
 * A single workers process can serve every platform (default), or one platform
 * only via `--platform=telegram` / `--platform telegram` /
 * `WORKER_PLATFORMS=telegram,twitch`. Running a process per platform isolates
 * crashes and lets each scale independently.
 */
function platformArgValue(args: string[]): string | undefined {
  const equals = args.find((a) => a.startsWith('--platform='));
  if (equals) return equals.split('=')[1];
  const idx = args.indexOf('--platform');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return undefined;
}

const requested = process.env.WORKER_PLATFORMS ?? platformArgValue(process.argv);
const requestedPlatforms = new Set(
  (requested ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function registerScript(s: { id: string; botId: string; trigger: string; config: unknown }): void {
  const cfg = s.config as unknown as {
    filters?: ScriptConfig['filters'];
    actions: ScriptConfig['actions'];
    variables?: Record<string, unknown>;
    cooldown?: number;
    interval?: number;
    maxExecutionMs?: number;
  };
  scriptEngine.register(s.botId, {
    id: s.id,
    trigger: s.trigger,
    filters: cfg.filters,
    actions: cfg.actions,
    variables: cfg.variables,
    cooldown: cfg.cooldown,
    interval: cfg.interval,
    maxExecutionMs: cfg.maxExecutionMs,
  });
}

/**
 * Loads scripts into the engine. `botIds` narrows the reload to the affected
 * bots (script edits/creates/deletes know their bot); without it, every script
 * is reloaded. A full reload clears the engine (wiping all bots' cooldowns and
 * counters), so targeted reloads also stop one user's script edit from resetting
 * every other bot's runtime state.
 */
async function loadScripts(botIds?: string[]): Promise<void> {
  if (botIds && botIds.length > 0) {
    for (const botId of botIds) {
      scriptEngine.unregister(botId);
      const scripts = await prisma.script.findMany({ where: { enabled: true, botId } });
      for (const s of scripts) registerScript(s);
      console.log(`Reloaded ${scripts.length} scripts for bot ${botId}`);
    }
    return;
  }
  const allScripts = await prisma.script.findMany({ where: { enabled: true } });
  scriptEngine.clear();
  for (const s of allScripts) registerScript(s);
  console.log(`Loaded ${allScripts.length} scripts`);
}

function buildScriptApi(worker: BaseWorker, botId: string): ScriptApi {
  return {
    sendMessage: (chatId: string | number, text: string, opts?: Record<string, unknown>) => {
      const { text: _t, chatId: _c, ...rest } = opts ?? {};
      return worker.executeRateLimited(botId, {
        type: 'sendMessage',
        payload: { chatId, text, ...rest },
      });
    },
    sendPhoto: (chatId: string | number, photo: string, caption?: string) =>
      worker.executeRateLimited(botId, { type: 'sendPhoto', payload: { chatId, photo, caption } }),
    deleteMessage: (chatId: string | number, messageId: number) =>
      worker.executeRateLimited(botId, { type: 'deleteMessage', payload: { chatId, messageId } }),
    say: (channel: string, message: string) =>
      worker.executeRateLimited(botId, { type: 'say', payload: { channel, message } }),
    timeout: (channel: string, user: string, seconds: number, reason?: string) =>
      worker.executeRateLimited(botId, {
        type: 'timeout',
        payload: { channel, user, seconds, reason },
      }),
    tweet: (text: string) => worker.executeRateLimited(botId, { type: 'tweet', payload: { text } }),
    reply: (text: string, tweetId: string) =>
      worker.executeRateLimited(botId, { type: 'reply', payload: { text, tweetId } }),
    react: (payload: Record<string, unknown>) =>
      worker.executeRateLimited(botId, { type: 'react', payload }),
    getPrice: (symbol: string) =>
      worker.executeRateLimited(botId, { type: 'getPrice', payload: { symbol } }),
    getCandles: (symbol: string, interval?: string, limit?: number) =>
      worker.executeRateLimited(botId, {
        type: 'getCandles',
        payload: { symbol, interval, limit },
      }),
    getBalance: (asset: string) =>
      worker.executeRateLimited(botId, { type: 'getBalance', payload: { asset } }),
    marketBuy: (symbol: string, amountUsdt: number) =>
      worker.executeRateLimited(botId, { type: 'marketBuy', payload: { symbol, amountUsdt } }),
    marketSell: (symbol: string, quantity: number) =>
      worker.executeRateLimited(botId, { type: 'marketSell', payload: { symbol, quantity } }),
    getWallet: () => worker.executeRateLimited(botId, { type: 'getWallet', payload: {} }),
    log: (level: string, message: string, meta?: object) => {
      const createdAt = new Date().toISOString();
      return prisma.log.create({ data: { botId, level, message, meta: meta ?? {} } }).then(() => {
        publishLog({ botId, level, message, meta: meta ?? {}, createdAt });
      });
    },
    fetch: async (url: string, opts?: RequestInit) => {
      // Every hop (including redirects) is SSRF-validated, so scripts cannot
      // reach internal/private hosts through api.fetch.
      return fetchWithGuard(url, opts);
    },
    remember: <T>(key: string, value: T, ttl?: number) =>
      botMemory.remember(botId, key, value, ttl),
    recall: <T>(key: string) => botMemory.recall<T>(botId, key),
    forget: (key: string) => botMemory.forget(botId, key),
  };
}

/**
 * Runs the event's matching scripts and counts the execution for the
 * `bothive_bot_script_executions_total` metric. Scripts that throw are caught
 * by ScriptEngine (Promise.allSettled), so failures never propagate here.
 */
async function runScripts(
  worker: BaseWorker,
  botId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const api = buildScriptApi(worker, botId);
  // The execution counter tracks scripts that actually ran; count only after
  // the engine finishes (allSettled inside, so this always resolves).
  await scriptEngine.execute(botId, event, api);
  worker.recordScriptExecution(botId);
}

const workers = [
  new TelegramWorker(redisUrl),
  new TwitchWorker(redisUrl),
  new YoutubeWorker(redisUrl),
  new TwitterWorker(redisUrl),
  new CryptoWorker(redisUrl),
].filter((w) => requestedPlatforms.size === 0 || requestedPlatforms.has(w.platformName));

if (workers.length === 0) {
  console.error(
    `[workers] No platforms match ${requested}. Choose from telegram, twitch, youtube, twitter, crypto.`,
  );
  process.exit(1);
}

console.log(`[workers] Serving platforms: ${workers.map((w) => w.platformName).join(', ')}`);

const manager = new WorkerManager(workers);

// Script failures are attributed to the bot's platform worker, so the error
// counter lands in the same health payload as `scriptExecutions` and the
// failure-rate alert has both series. `hasBot` (not `isConnected`) is used so
// a bot that failed a script right as its connection dropped is still counted.
scriptEngine.onScriptError = (botId: string) => {
  const worker = workers.find((w) => w.hasBot(botId));
  if (worker) worker.recordScriptError(botId);
};

const stopScriptTrigger = startScriptTrigger({
  prisma,
  engine: scriptEngine,
  workers,
  buildApi: buildScriptApi,
});
const heartbeat = startWorkerHeartbeat(
  redisUrl,
  workers.map((w) => ({
    platform: w.platformName,
    instanceId: w.instanceId,
    concurrency: w.getConcurrency(),
    wait: () => w.getWaitPercentiles(),
    sandboxWorkers: () => scriptEngine.sandboxWorkerCount(),
  })),
);
startWebhookWorker();

for (const worker of workers) {
  worker.onEvent((event: PlatformEvent) => {
    // Only the fast Redis bus publish is awaited. Script processing and webhook
    // delivery are decoupled (void) so a slow script or a slow webhook endpoint
    // can never stall the platform's ingestion loop — Telegram long-polling in
    // particular would otherwise stop fetching updates while a script runs.
    void bus
      .emit(Events.BotEvent, event)
      .catch((err) => console.error(`[workers] Bus emit failed for ${event.botId}:`, err));
    void dispatchWebhooks(prisma, {
      botId: event.botId,
      platform: event.platform,
      type: event.type,
      payload: event.payload,
      timestamp: event.timestamp,
    }).catch((err) => console.error(`[workers] Webhook dispatch failed:`, err));
    void runScripts(worker, event.botId, {
      ...event,
      ...((event.payload as Record<string, unknown> | undefined) ?? {}),
    }).catch((err) => console.error(`[workers] Script run failed for ${event.botId}:`, err));
  });
}

setInterval(async () => {
  try {
    const bots = scriptEngine.intervalBots();
    if (bots.length === 0) return;

    const found = await prisma.bot.findMany({
      where: { id: { in: bots } },
      select: { id: true, platform: true },
    });
    const byPlatform = new Map<string, string[]>();
    for (const b of found) {
      const list = byPlatform.get(b.platform) ?? [];
      list.push(b.id);
      byPlatform.set(b.platform, list);
    }

    for (const [platform, ids] of byPlatform) {
      const worker = workers.find((w) => w.platformName === platform);
      if (!worker) continue;
      const connected = ids.filter((botId) => worker.isConnected(botId));
      await mapLimit(connected, INTERVAL_DISPATCH_CONCURRENCY, async (botId) => {
        try {
          await runScripts(worker, botId, { type: 'interval', botId, platform });
          void dispatchWebhooks(prisma, {
            botId,
            platform,
            type: 'interval',
            payload: {},
            timestamp: new Date(),
          });
        } catch (err) {
          console.error(`[workers] Interval script failed for ${botId}:`, err);
        }
      });
    }
  } catch (err) {
    console.error('[workers] Interval dispatcher error:', err);
  }
}, INTERVAL_POLL_MS);

let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  // SIGTERM/SIGINT and an uncaughtException can overlap (or arrive while a
  // previous shutdown is draining); never run the teardown twice.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down workers...');
  try {
    await manager.shutdown();
    await stopWebhookWorker();
    await memoryStore.disconnect();
    await disconnectScriptSync();
    await stopScriptTrigger();
    await heartbeat.stop();
    await disconnectLogPublisher();
    await shutdownTracing();
  } finally {
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));

process.on('unhandledRejection', (reason) => {
  console.error('[workers] Unhandled promise rejection:', reason);
});

// A crash must surface to the supervisor (PM2/Docker restart policy, alerting)
// as a non-zero exit — exiting 0 on an uncaughtException would look like a
// clean stop and silently hide the failure.
process.on('uncaughtException', (err) => {
  console.error('[workers] Uncaught exception:', err);
  void shutdown(1);
});

// A DB outage at boot must not abort the whole module: the workers (Redis
// heartbeat, webhook delivery, polling) can still run while the DB is down,
// and the scripts load once script-sync or the DB recovers.
try {
  await loadScripts();
} catch (err) {
  console.error('[workers] Initial script load failed; scripts load on the next sync:', err);
}
watchScriptChanges(loadScripts);
await manager.start();
console.log('BotHive Workers by ssrjkk — all workers started. Script engine ready.');
