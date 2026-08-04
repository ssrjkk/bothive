import { Worker, Queue, Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { IBotPlatform } from '@bothive/core';
import type { QueueJob } from '@bothive/core';
import { decryptCredential } from '@bothive/core';
import { prisma } from './prisma.js';
import { publishLog } from './log-publisher.js';
import { dispatchWebhooks } from './webhooks.js';

const RECONNECT_BACKOFFS = [5000, 15000, 30000, 60000, 120000];
const MAX_RECONNECT_ATTEMPTS = 10;
const AUTO_START_CONCURRENCY = 5;

/**
 * Runs `fn` over `items` with at most `limit` tasks in flight at once. Keeps
 * startup and interval dispatch bounded instead of firing one event-loop
 * blocking burst (or a slow sequential chain) when many bots are involved.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

export abstract class BaseWorker implements IBotPlatform {
  abstract readonly platformName: string;
  protected queue: Queue;
  protected worker: Worker;
  protected prisma: PrismaClient = prisma;
  protected bots: Map<string, { instance: unknown; status: string; reconnectAttempts: number; connectedAt?: Date }> = new Map();
  protected eventHandlers: Map<string, Function[]> = new Map();
  protected reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    queueName: string,
    redisUrl: string,
    concurrency?: number,
  ) {
    const resolvedConcurrency = concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 10);

    const connection = { url: redisUrl };

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.worker = new Worker(
      queueName,
      async (job: Job<QueueJob>) => this.processJob(job),
      { connection, concurrency: resolvedConcurrency },
    );

    this.worker.on('completed', (job) => {
      console.log(`[${this.platformName}] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[${this.platformName}] Job ${job?.id} failed:`, err.message);
    });
  }

  abstract connect(credentials: Record<string, unknown>): Promise<void>;
  abstract disconnect(botId: string): Promise<void>;
  abstract executeAction(botId: string, action: { type: string; payload: object }): Promise<unknown>;
  abstract getStatus(botId: string): string;
  abstract isConnected(botId: string): boolean;

  onEvent(handler: Function): void {
    const key = 'default';
    const handlers = this.eventHandlers.get(key) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(key, handlers);
  }

  protected async writeLog(botId: string, level: string, message: string, meta?: object): Promise<void> {
    try {
      const createdAt = new Date();
      await this.prisma.log.create({
        data: { botId, level, message, meta: meta ?? {} },
      });
      publishLog({ botId, level, message, meta: meta ?? {}, createdAt: createdAt.toISOString() });
    } catch (err) {
      console.error(`[${this.platformName}] writeLog failed for ${botId}:`, err);
    }
  }

  /**
   * Marks a bot as connecting without resetting its reconnect attempts, so the
   * exponential backoff actually grows across repeated failed connects.
   */
  protected prepareConnect(botId: string): void {
    const existing = this.bots.get(botId);
    if (existing) {
      existing.status = 'connecting';
      existing.instance = null;
    } else {
      this.bots.set(botId, { instance: null, status: 'connecting', reconnectAttempts: 0 });
    }
  }

  protected async emit(event: { botId: string; platform: string; type: string; payload: object; timestamp: Date }): Promise<void> {
    const handlers = this.eventHandlers.get('default') ?? [];
    await Promise.all(handlers.map((h) => h(event)));

    void this.writeLog(event.botId, 'info', `Event: ${event.type}`, event.payload as object);
  }

  protected async markConnected(botId: string): Promise<void> {
    const entry = this.bots.get(botId);
    const connectedAt = new Date();
    if (entry) {
      entry.status = 'running';
      entry.reconnectAttempts = 0;
      entry.connectedAt = connectedAt;
    }
    try {
      await this.prisma.bot.update({
        where: { id: botId },
        data: { status: 'running', connectedAt },
      });
    } catch (err) {
      // Bot row may have been deleted while we were connecting.
      console.error(`[${this.platformName}] markConnected failed for ${botId}:`, err);
    }
    const timer = this.reconnectTimers.get(botId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(botId);
    }
    void dispatchWebhooks(this.prisma, {
      botId,
      platform: this.platformName,
      type: 'status',
      payload: { status: 'running', connectedAt: connectedAt.toISOString() },
      timestamp: connectedAt,
    });
  }

  protected async markDisconnected(botId: string, error?: string): Promise<void> {
    const entry = this.bots.get(botId);
    if (entry) {
      entry.status = error ? 'error' : 'idle';
    }
    try {
      await this.prisma.bot.update({
        where: { id: botId },
        data: { status: error ? 'error' : 'idle', connectedAt: null },
      });
    } catch (err) {
      console.error(`[${this.platformName}] markDisconnected failed for ${botId}:`, err);
    }
    if (error) {
      await this.writeLog(botId, 'error', error);
    }
    void dispatchWebhooks(this.prisma, {
      botId,
      platform: this.platformName,
      type: 'status',
      payload: error ? { status: 'error', error } : { status: 'idle' },
      timestamp: new Date(),
    });
  }

  protected async markReconnecting(botId: string): Promise<void> {
    const entry = this.bots.get(botId);
    if (entry) entry.status = 'reconnecting';
    try {
      await this.prisma.bot.update({
        where: { id: botId },
        data: { status: 'reconnecting', connectedAt: null },
      });
    } catch (err) {
      console.error(`[${this.platformName}] markReconnecting failed for ${botId}:`, err);
    }
    void dispatchWebhooks(this.prisma, {
      botId,
      platform: this.platformName,
      type: 'status',
      payload: { status: 'reconnecting' },
      timestamp: new Date(),
    });
  }

  protected async scheduleReconnect(botId: string, credentials: Record<string, unknown>): Promise<void> {
    const entry = this.bots.get(botId);
    if (!entry) return;

    const attempt = entry.reconnectAttempts ?? 0;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[${this.platformName}] Giving up reconnecting ${botId} after ${attempt} attempts`);
      entry.reconnectAttempts = 0;
      await this.markDisconnected(botId, `Gave up reconnecting after ${attempt} attempts`);
      return;
    }

    const existing = this.reconnectTimers.get(botId);
    if (existing) clearTimeout(existing);

    const delay = RECONNECT_BACKOFFS[Math.min(attempt, RECONNECT_BACKOFFS.length - 1)];

    entry.reconnectAttempts = attempt + 1;

    console.log(`[${this.platformName}] Scheduling reconnect for ${botId} in ${delay}ms (attempt ${attempt + 1})`);

    await this.writeLog(botId, 'warn', `Reconnecting in ${delay}ms (attempt ${attempt + 1})`);

    const timer = setTimeout(async () => {
      try {
        await this.connect(credentials);
      } catch (err) {
        console.error(`[${this.platformName}] Reconnect failed for ${botId}:`, err);
        await this.scheduleReconnect(botId, credentials);
      }
    }, delay);

    this.reconnectTimers.set(botId, timer);
  }

  async autoStartBots(): Promise<void> {
    try {
      const bots = await this.prisma.bot.findMany({
        where: { platform: this.platformName, status: { in: ['running', 'connecting'] } },
        include: { account: true },
      });

      console.log(`[${this.platformName}] Auto-starting ${bots.length} bots...`);

      await mapLimit(bots, AUTO_START_CONCURRENCY, async (bot) => {
        const credentials: Record<string, unknown> = { botId: bot.id };
        const token = decryptCredential(bot.account.token);
        if (token) credentials.token = token;
        const clientId = decryptCredential(bot.account.clientId);
        if (clientId) credentials.clientId = clientId;
        const secret = decryptCredential(bot.account.secret);
        if (secret) credentials.clientSecret = secret;
        const refreshToken = decryptCredential(bot.account.refreshToken);
        if (refreshToken) credentials.refreshToken = refreshToken;
        const apiKey = decryptCredential(bot.account.apiKey);
        if (apiKey) credentials.apiKey = apiKey;

        const config = (bot.config ?? {}) as Record<string, unknown>;
        if (config.channelId) credentials.channelId = config.channelId;
        if (config.username) credentials.username = config.username;
        if (config.channel) credentials.channel = config.channel;

        this.bots.set(bot.id, { instance: null as unknown, status: 'connecting', reconnectAttempts: 0 });

        try {
          await this.connect(credentials);
        } catch (err) {
          console.error(`[${this.platformName}] Auto-start failed for ${bot.id}:`, err);
          await this.markDisconnected(bot.id, `Auto-start failed: ${err}`);
          await this.scheduleReconnect(bot.id, credentials);
        }
      });
    } catch (err) {
      console.error(`[${this.platformName}] Auto-start error:`, err);
    }
  }

  private async processJob(job: Job<QueueJob>): Promise<void> {
    switch (job.data.type) {
      case 'connect':
        await this.connect(job.data.data as Record<string, unknown>);
        return;
      case 'disconnect':
        await this.disconnect(job.data.botId);
        return;
      case 'execute':
        await this.executeAction(job.data.botId, job.data.data as { type: string; payload: object });
        return;
      default:
        console.warn(`[${this.platformName}] Unknown job type: ${job.data.type}`);
    }
  }

  async start(): Promise<void> {
    await this.worker.waitUntilReady();
    console.log(`[${this.platformName}] Worker ready, concurrency: ${this.worker.opts.concurrency}`);
    await this.autoStartBots();
  }

  async shutdown(): Promise<void> {
    for (const [, timer] of this.reconnectTimers) clearTimeout(timer);
    this.reconnectTimers.clear();

    await this.worker.close(); // waits for running jobs up to 30s

    for (const [botId] of this.bots) {
      try { await this.disconnect(botId); }
      catch (err) { console.error(`[${this.platformName}] Error disconnecting ${botId}:`, err); }
    }

    await this.queue.close();
    await this.prisma.$disconnect();
    console.log(`[${this.platformName}] Worker shut down`);
  }

  getQueue(): Queue {
    return this.queue;
  }
}

export class WorkerManager {
  private workers: BaseWorker[];

  constructor(workers: BaseWorker[]) {
    this.workers = workers;
  }

  async start(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.start()));
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.shutdown()));
  }
}
