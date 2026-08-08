import { Redis } from 'ioredis';
import type { PrismaClient } from '../../api/prisma/generated/prisma/client.js';
import { redisConnectionOptions } from '@bothive/core';
import { ScriptEngine, ScriptConfig, ScriptApi } from './script-engine.js';
import type { BaseWorker } from './base-worker.js';

const TRIGGER_CHANNEL = 'bothive:script:trigger';

export interface ScriptTriggerOptions {
  prisma: PrismaClient;
  engine: ScriptEngine;
  workers: BaseWorker[];
  buildApi: (worker: BaseWorker, botId: string) => ScriptApi;
}

export function startScriptTrigger(options: ScriptTriggerOptions): () => Promise<void> {
  const subscriber = new Redis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    redisConnectionOptions(),
  );
  subscriber.on('error', (err) => console.error('[script-trigger] redis error:', err));
  subscriber.subscribe(TRIGGER_CHANNEL, (err) => {
    if (err) console.error('[script-trigger] subscribe failed:', err);
  });
  subscriber.on('message', (_channel, message) => {
    void handleTrigger(message, options).catch((err) =>
      console.error('[script-trigger] handler error:', err),
    );
  });
  return async () => {
    await subscriber.quit().catch(() => undefined);
  };
}

export async function handleTrigger(raw: string, options: ScriptTriggerOptions): Promise<void> {
  const { prisma, engine, workers, buildApi } = options;

  let msg: { botId?: string; scriptId?: string; sample?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }
  if (!msg.scriptId || !msg.botId) return;

  const script = await prisma.script.findUnique({ where: { id: msg.scriptId } });
  if (!script || script.botId !== msg.botId) return;

  const bot = await prisma.bot.findUnique({ where: { id: msg.botId } });
  if (!bot) return;

  const worker = workers.find((w) => w.platformName === bot.platform);
  if (!worker) return;

  const cfg = script.config as unknown as Partial<ScriptConfig>;
  const config: ScriptConfig = {
    trigger: script.trigger,
    filters: cfg.filters,
    actions: cfg.actions ?? [],
    variables: cfg.variables,
    cooldown: cfg.cooldown,
    interval: cfg.interval,
    maxExecutionMs: cfg.maxExecutionMs,
  };

  const event = buildSampleEvent(script.trigger, msg.sample ?? {});
  const api = buildApi(worker, bot.id);
  await engine.executeOnce(config, bot.id, event, api);
  await api.log(
    'info',
    `Manual test: script "${script.name}" (trigger: ${script.trigger}) executed`,
  );
}

const TRIGGER_SAMPLES: Record<string, Record<string, unknown>> = {
  message: {
    text: 'Test message from dashboard',
    chatId: 'test-chat',
    id: 'test-msg-1',
    username: 'test_user',
  },
  follow: { username: 'test_user', id: 'test-follow-1' },
  subscribe: { username: 'test_user', tier: '1000', id: 'test-sub-1' },
  donation: {
    amount: 5,
    currency: 'USD',
    message: 'Test donation',
    username: 'test_user',
    id: 'test-don-1',
  },
  comment: { text: 'Test comment from dashboard', authorId: 'test_author', id: 'test-comment-1' },
  interval: {},
};

export function buildSampleEvent(
  trigger: string,
  sample: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: trigger,
    timestamp: new Date().toISOString(),
    ...(TRIGGER_SAMPLES[trigger] ?? { text: 'Test trigger', username: 'test_user' }),
    ...sample,
  };
}
