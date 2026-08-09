import { config } from 'dotenv';
import type { PlatformEvent } from '@bothive/core';
import { bus, Events, RedisMemoryStore, BotMemory } from '@bothive/core';
import { prisma } from './prisma.js';
import { BaseWorker, WorkerManager, mapLimit } from './base-worker.js';
import { TelegramWorker } from './telegram/worker.js';
import { TwitchWorker } from './twitch/worker.js';
import { YoutubeWorker } from './youtube/worker.js';
import { TwitterWorker } from './twitter/worker.js';
import { ScriptEngine, ScriptConfig, ScriptApi } from './script-engine.js';
import { publishLog, disconnectLogPublisher } from './log-publisher.js';
import { watchScriptChanges, disconnectScriptSync } from './script-sync.js';
import { startScriptTrigger } from './script-trigger.js';
import { dispatchWebhooks, startWebhookWorker, stopWebhookWorker } from './webhooks.js';
import { startWorkerHeartbeat } from './heartbeat.js';
import { validateWorkerSecrets, fetchWithGuard, initSentry } from '@bothive/core';

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
 * only via `--platform=telegram` / `WORKER_PLATFORMS=telegram,twitch`. Running
 * a process per platform isolates crashes and lets each scale independently.
 */
const requested =
  process.env.WORKER_PLATFORMS ??
  process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1];
const requestedPlatforms = new Set(
  (requested ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

async function loadScripts(): Promise<void> {
  const allScripts = await prisma.script.findMany({ where: { enabled: true } });
  scriptEngine.clear();
  for (const s of allScripts) {
    const cfg = s.config as unknown as {
      filters?: ScriptConfig['filters'];
      actions: ScriptConfig['actions'];
      variables?: Record<string, unknown>;
      cooldown?: number;
      interval?: number;
      maxExecutionMs?: number;
    };
    scriptEngine.register(s.botId, {
      trigger: s.trigger,
      filters: cfg.filters,
      actions: cfg.actions,
      variables: cfg.variables,
      cooldown: cfg.cooldown,
      interval: cfg.interval,
      maxExecutionMs: cfg.maxExecutionMs,
    });
  }
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
  worker.recordScriptExecution(botId);
  const api = buildScriptApi(worker, botId);
  await scriptEngine.execute(botId, event, api);
}

const workers = [
  new TelegramWorker(redisUrl),
  new TwitchWorker(redisUrl),
  new YoutubeWorker(redisUrl),
  new TwitterWorker(redisUrl),
].filter((w) => requestedPlatforms.size === 0 || requestedPlatforms.has(w.platformName));

if (workers.length === 0) {
  console.error(
    `[workers] No platforms match ${requested}. Choose from telegram, twitch, youtube, twitter.`,
  );
  process.exit(1);
}

console.log(`[workers] Serving platforms: ${workers.map((w) => w.platformName).join(', ')}`);

const manager = new WorkerManager(workers);

// Script failures are attributed to the bot's platform worker, so the error
// counter lands in the same health payload as `scriptExecutions` and the
// failure-rate alert has both series.
scriptEngine.onScriptError = (botId: string) => {
  const worker = workers.find((w) => w.isConnected(botId));
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
    concurrency: w.getConcurrency(),
    wait: () => w.getWaitPercentiles(),
  })),
);
startWebhookWorker();

for (const worker of workers) {
  worker.onEvent(async (event: PlatformEvent) => {
    await bus.emit(Events.BotEvent, event);

    void dispatchWebhooks(prisma, {
      botId: event.botId,
      platform: event.platform,
      type: event.type,
      payload: event.payload,
      timestamp: event.timestamp,
    });

    await runScripts(worker, event.botId, {
      ...event,
      ...((event.payload as Record<string, unknown> | undefined) ?? {}),
    });
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

async function shutdown(): Promise<void> {
  console.log('Shutting down workers...');
  await manager.shutdown();
  await stopWebhookWorker();
  await memoryStore.disconnect();
  await disconnectScriptSync();
  await stopScriptTrigger();
  await heartbeat.stop();
  await disconnectLogPublisher();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

process.on('unhandledRejection', (reason) => {
  console.error('[workers] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[workers] Uncaught exception:', err);
  void shutdown();
});

await loadScripts();
watchScriptChanges(loadScripts);
await manager.start();
console.log('BotHive Workers by ssrjkk — all workers started. Script engine ready.');
