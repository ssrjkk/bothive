import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import type { PlatformEvent } from '@bothive/core';
import { bus, Events, RedisMemoryStore, BotMemory } from '@bothive/core';
import { BaseWorker, WorkerManager } from './base-worker.js';
import { TelegramWorker } from './telegram/worker.js';
import { TwitchWorker } from './twitch/worker.js';
import { YoutubeWorker } from './youtube/worker.js';
import { TwitterWorker } from './twitter/worker.js';
import { ScriptEngine, ScriptConfig, ScriptApi } from './script-engine.js';
import { publishLog, disconnectLogPublisher } from './log-publisher.js';
import { watchScriptChanges, disconnectScriptSync } from './script-sync.js';
import { startScriptTrigger } from './script-trigger.js';
import { dispatchWebhooks } from './webhooks.js';
import { validateWorkerSecrets, fetchWithGuard } from '@bothive/core';

config();

validateWorkerSecrets();

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();
const scriptEngine = new ScriptEngine();
const memoryStore = new RedisMemoryStore(redisUrl);
const botMemory = new BotMemory(memoryStore);

const INTERVAL_POLL_MS = 30_000;

async function loadScripts(): Promise<void> {
  const allScripts = await prisma.script.findMany({ where: { enabled: true } });
  scriptEngine.clear();
  for (const s of allScripts) {
    const cfg = s.config as unknown as { filters?: ScriptConfig['filters']; actions: ScriptConfig['actions']; variables?: Record<string, unknown>; cooldown?: number; interval?: number };
    scriptEngine.register(s.botId, {
      trigger: s.trigger,
      filters: cfg.filters,
      actions: cfg.actions,
      variables: cfg.variables,
      cooldown: cfg.cooldown,
      interval: cfg.interval,
    });
  }
  console.log(`Loaded ${allScripts.length} scripts`);
}

function buildScriptApi(worker: BaseWorker, botId: string): ScriptApi {
  return {
    sendMessage: (chatId: string | number, text: string, opts?: Record<string, unknown>) => {
      const { text: _t, chatId: _c, ...rest } = opts ?? {};
      return worker.executeAction(botId, { type: 'sendMessage', payload: { chatId, text, ...rest } });
    },
    sendPhoto: (chatId: string | number, photo: string, caption?: string) =>
      worker.executeAction(botId, { type: 'sendPhoto', payload: { chatId, photo, caption } }),
    deleteMessage: (chatId: string | number, messageId: number) =>
      worker.executeAction(botId, { type: 'deleteMessage', payload: { chatId, messageId } }),
    say: (channel: string, message: string) =>
      worker.executeAction(botId, { type: 'say', payload: { channel, message } }),
    timeout: (channel: string, user: string, seconds: number, reason?: string) =>
      worker.executeAction(botId, { type: 'timeout', payload: { channel, user, seconds, reason } }),
    tweet: (text: string) =>
      worker.executeAction(botId, { type: 'tweet', payload: { text } }),
    reply: (text: string, tweetId: string) =>
      worker.executeAction(botId, { type: 'reply', payload: { text, tweetId } }),
    react: (payload: Record<string, unknown>) =>
      worker.executeAction(botId, { type: 'react', payload }),
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
    remember: <T>(key: string, value: T, ttl?: number) => botMemory.remember(botId, key, value, ttl),
    recall: <T>(key: string) => botMemory.recall<T>(botId, key),
  };
}

const workers = [
  new TelegramWorker(redisUrl),
  new TwitchWorker(redisUrl),
  new YoutubeWorker(redisUrl),
  new TwitterWorker(redisUrl),
];

const manager = new WorkerManager(workers);
const stopScriptTrigger = startScriptTrigger({ prisma, engine: scriptEngine, workers, buildApi: buildScriptApi });

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

    const api = buildScriptApi(worker, event.botId);
    await scriptEngine.execute(event.botId, { ...event, ...(event.payload as Record<string, unknown> | undefined ?? {}) }, api);
  });
}

setInterval(async () => {
  try {
    const bots = scriptEngine.intervalBots();
    if (bots.length === 0) return;

    const found = await prisma.bot.findMany({ where: { id: { in: bots } }, select: { id: true, platform: true } });
    const byPlatform = new Map<string, string[]>();
    for (const b of found) {
      const list = byPlatform.get(b.platform) ?? [];
      list.push(b.id);
      byPlatform.set(b.platform, list);
    }

    for (const [platform, ids] of byPlatform) {
      const worker = workers.find((w) => w.platformName === platform);
      if (!worker) continue;
      for (const botId of ids) {
        try {
          if (!worker.isConnected(botId)) continue;
          await scriptEngine.execute(botId, { type: 'interval', botId, platform }, buildScriptApi(worker, botId));
          void dispatchWebhooks(prisma, { botId, platform, type: 'interval', payload: {}, timestamp: new Date() });
        } catch (err) {
          console.error(`[workers] Interval script failed for ${botId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[workers] Interval dispatcher error:', err);
  }
}, INTERVAL_POLL_MS);

async function shutdown(): Promise<void> {
  console.log('Shutting down workers...');
  await manager.shutdown();
  await memoryStore.disconnect();
  await disconnectScriptSync();
  await stopScriptTrigger();
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