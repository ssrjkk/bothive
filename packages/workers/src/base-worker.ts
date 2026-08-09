import { Worker, Queue, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../api/prisma/generated/prisma/client.js';
import type { IBotPlatform, PlatformEvent } from '@bothive/core';
import type { QueueJob } from '@bothive/core';
import {
  decryptCredential,
  RedisRateLimiter,
  CircuitBreaker,
  HealthScoreTracker,
  calculateBackoff,
  redisConnectionOptions,
  ProxyPool,
} from '@bothive/core';
import { prisma } from './prisma.js';
import { publishLog } from './log-publisher.js';
import { dispatchWebhooks } from './webhooks.js';
import { WaitTimeTracker } from './wait-tracker.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const AUTO_START_CONCURRENCY = 5;

// --- Outbound rate limiting -------------------------------------------------
//
// Platform APIs throttle bursts (Telegram ~30 msg/s, Twitch 20 msg/30s per
// channel, X/Twitter and YouTube per-endpoint). A runaway script or a loop that
// fires sendMessage/say/tweet in a tight loop can otherwise trip the provider
// and get the bot throttled or banned. The limiter is Redis-backed and scoped
// per bot+action, so budgets are shared across all worker replicas of the same
// platform (a `--scale` fleet enforces one combined budget, not N budgets).
const OUTBOUND_MAX_PER_WINDOW = Number(process.env.OUTBOUND_MAX_PER_WINDOW ?? 30);
const OUTBOUND_WINDOW_MS = Number(process.env.OUTBOUND_WINDOW_MS ?? 60_000);
// Read-like / housekeeping actions are not outbound sends and should never be
// throttled.
const OUTBOUND_EXEMPT_ACTIONS = new Set(['deleteMessage', 'listComments']);

// --- Leader election ------------------------------------------------------
//
// Scaling the same platform to several worker processes (`--scale workers-X=N`)
// used to make every process connect the same bots (duplicate live connections,
// Telegram 409 conflicts, and duplicate events because the dedup sets are
// in-memory). The fix: only one process per platform may own live connections.
// Leadership is a Redis lease (`bothive:leader:<platform>`) renewed every few
// seconds. When the leader dies the lease expires and another replica takes
// over and reconnects the bots вЂ” so `--scale` gives HA/failover, never
// duplicate connections.
const LEADER_KEY_PREFIX = 'bothive:leader:';
const LEADER_TTL_MS = 30_000;
const LEADER_CHECK_INTERVAL_MS = 10_000;
const RECONCILE_INTERVAL_MS = 30_000;

const leaderRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  ...redisConnectionOptions(),
  lazyConnect: true,
});
void leaderRedis
  .connect()
  .catch((err) => console.error('[workers] leader-election Redis connect failed:', err));

const outboundRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  ...redisConnectionOptions(),
  lazyConnect: true,
});
void outboundRedis
  .connect()
  .catch((err) => console.error('[workers] outbound-rate-limit Redis connect failed:', err));

const outboundLimiter = new RedisRateLimiter(
  outboundRedis,
  'bothive:outbound:',
  OUTBOUND_MAX_PER_WINDOW,
  OUTBOUND_WINDOW_MS,
);

// --- Connection circuit breaker & adaptive backoff -------------------------
//
// A bot that fails to connect used to be retried on a fixed linear schedule
// ([5s, 15s, 30s, 60s, 120s]) until it gave up after 10 attempts, hammering the
// platform provider every few seconds even when the account was banned or the
// platform was down. Now each bot has a circuit breaker (trips after 5
// consecutive connect failures, then only probes once per minute) and the
// reconnect delay is exponential with jitter, scaled by the bot's recent
// failure rate вЂ” so a failing bot backs off hard instead of hammering, and a
// fleet never reconnects in lock-step.
const CIRCUIT_FAILURE_THRESHOLD = 5;
// One successful connect after the cooldown is the recovery check: it closes
// the circuit and returns the bot to normal reconnection behavior.
const CIRCUIT_SUCCESS_THRESHOLD = 1;
const CIRCUIT_RESET_TIMEOUT_MS = 60_000;

// Health scores (0-100 over a 1h sliding window) are published to Redis so the
// API's /metrics endpoint can expose `bothive_bot_health_score`. TTL is longer
// than the publish interval so a bot that just stops emitting keeps its score
// briefly visible before dropping out.
const HEALTH_KEY_PREFIX = 'bothive:health:';
const HEALTH_TTL_SECONDS = 180;

const healthRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  ...redisConnectionOptions(),
  lazyConnect: true,
});
void healthRedis
  .connect()
  .catch((err) => console.error('[workers] health-score Redis connect failed:', err));

/**
 * Runs `fn` over `items` with at most `limit` tasks in flight at once. Keeps
 * startup and interval dispatch bounded instead of firing one event-loop
 * blocking burst (or a slow sequential chain) when many bots are involved.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
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

interface BotEntry {
  instance: unknown;
  status: string;
  reconnectAttempts: number;
  connectedAt?: Date;
  /** Per-bot send budget from bot.config.rateLimitPerMinute (undefined = global). */
  rateLimitPerMinute?: number;
  /** Counters since this process connected the bot, exported to Prometheus via the health payload. */
  actionsSuccess: number;
  actionsFailed: number;
  scriptExecutions: number;
  scriptErrors: number;
}

export abstract class BaseWorker implements IBotPlatform {
  abstract readonly platformName: string;
  protected queue: Queue;
  protected worker: Worker;
  protected prisma: PrismaClient = prisma;
  protected bots: Map<string, BotEntry> = new Map();
  protected eventHandlers: Map<string, Array<(event: PlatformEvent) => unknown>> = new Map();
  protected reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  protected circuitBreakers: Map<string, CircuitBreaker> = new Map();
  protected healthScores: Map<string, HealthScoreTracker> = new Map();
  // Outbound proxy pool (refreshed from the DB every reconcile cycle). The
  // leader selects a healthy proxy per connect so direct connections never
  // hammer a single egress IP.
  protected proxies = new ProxyPool();
  private botProxyIds = new Map<string, string>();
  /** Lazily created per-bot outbound limiters for bot.config.rateLimitPerMinute. */
  private botRateLimiters = new Map<string, RedisRateLimiter>();

  readonly instanceId = randomUUID();
  protected isLeader = false;
  private leaderTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private readonly waitTracker = new WaitTimeTracker();

  constructor(queueName: string, redisUrl: string, concurrency?: number) {
    const resolvedConcurrency = concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 10);

    const connection = { url: redisUrl, ...redisConnectionOptions() };

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.worker = new Worker(queueName, async (job: Job<QueueJob>) => this.processJob(job), {
      connection,
      concurrency: resolvedConcurrency,
    });

    this.worker.on('completed', (job) => {
      console.log(`[${this.platformName}] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[${this.platformName}] Job ${job?.id} failed:`, err.message);
    });

    // Record how long jobs sat queued (enqueue -> active). The p50/p95/p99 of
    // this window ride the heartbeat and become `bothive_queue_wait_seconds`,
    // catching backlog that a waiting-depth gauge alone hides (jobs stuck
    // behind a slow platform call under the worker's concurrency).
    this.worker.on('active', (job) => {
      this.waitTracker.record(Date.now() - job.timestamp);
    });

    // Start paused: only the elected leader consumes control jobs for this
    // platform. Non-leaders stay paused (jobs wait in the queue until a leader
    // exists), so a connect/disconnect/execute job can never be executed twice.
    void this.worker
      .pause()
      .catch((err) => console.error(`[${this.platformName}] initial pause failed:`, err));
  }

  abstract connect(credentials: Record<string, unknown>): Promise<void>;
  abstract disconnect(botId: string): Promise<void>;
  abstract executeAction(
    botId: string,
    action: { type: string; payload: object },
  ): Promise<unknown>;
  abstract getStatus(botId: string): string;
  abstract isConnected(botId: string): boolean;

  onEvent(handler: (event: PlatformEvent) => unknown): void {
    const key = 'default';
    const handlers = this.eventHandlers.get(key) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(key, handlers);
  }

  protected getCircuitBreaker(botId: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(botId);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
        successThreshold: CIRCUIT_SUCCESS_THRESHOLD,
        resetTimeoutMs: CIRCUIT_RESET_TIMEOUT_MS,
      });
      this.circuitBreakers.set(botId, breaker);
    }
    return breaker;
  }

  protected getHealth(botId: string): HealthScoreTracker {
    let health = this.healthScores.get(botId);
    if (!health) {
      health = new HealthScoreTracker();
      this.healthScores.set(botId, health);
    }
    return health;
  }

  /** Returns (creating if needed) the in-memory tracking entry for a bot. */
  protected ensureBot(botId: string): BotEntry {
    let entry = this.bots.get(botId);
    if (!entry) {
      entry = {
        instance: null,
        status: 'connecting',
        reconnectAttempts: 0,
        actionsSuccess: 0,
        actionsFailed: 0,
        scriptExecutions: 0,
        scriptErrors: 0,
      };
      this.bots.set(botId, entry);
    }
    return entry;
  }

  /**
   * Publishes the current health score (0-100) and status of every tracked bot
   * to Redis under `bothive:health:<botId>` with a TTL. The API reads these
   * keys in its `/metrics` handler, so a per-bot `bothive_bot_health_score`
   * gauge is available to Prometheus.
   */
  protected async publishHealthScores(): Promise<void> {
    try {
      const updatedAt = new Date().toISOString();
      for (const [botId, entry] of this.bots) {
        const uptimeSeconds = entry.connectedAt
          ? Math.max(0, Math.floor((Date.now() - entry.connectedAt.getTime()) / 1000))
          : 0;
        const payload = JSON.stringify({
          score: Math.round(this.getHealth(botId).getScore()),
          status: entry.status,
          updatedAt,
          uptimeSeconds,
          actionsSuccess: entry.actionsSuccess ?? 0,
          actionsFailed: entry.actionsFailed ?? 0,
          reconnectAttempts: entry.reconnectAttempts ?? 0,
          scriptExecutions: entry.scriptExecutions ?? 0,
          scriptErrors: entry.scriptErrors ?? 0,
        });
        await healthRedis.set(HEALTH_KEY_PREFIX + botId, payload, 'EX', HEALTH_TTL_SECONDS);
      }
    } catch (err) {
      console.error(`[${this.platformName}] publishHealthScores failed:`, err);
    }
  }

  protected async writeLog(
    botId: string,
    level: string,
    message: string,
    meta?: object,
  ): Promise<void> {
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
      this.bots.set(botId, {
        instance: null,
        status: 'connecting',
        reconnectAttempts: 0,
        actionsSuccess: 0,
        actionsFailed: 0,
        scriptExecutions: 0,
        scriptErrors: 0,
      });
    }
  }

  protected async emit(event: PlatformEvent): Promise<void> {
    const handlers = this.eventHandlers.get('default') ?? [];
    await Promise.all(handlers.map((h) => h(event)));

    void this.writeLog(event.botId, 'info', `Event: ${event.type}`, event.payload as object);
  }

  protected async markConnected(botId: string): Promise<void> {
    const entry = this.ensureBot(botId);
    const connectedAt = new Date();
    entry.status = 'running';
    entry.reconnectAttempts = 0;
    entry.connectedAt = connectedAt;
    // A successful connect closes the circuit and restarts the health window.
    this.getCircuitBreaker(botId).recordSuccess();
    this.getHealth(botId).recordSuccess();
    // The proxy that carried this connection earned a success point.
    const proxyId = this.botProxyIds.get(botId);
    if (proxyId) {
      this.proxies.reportSuccess(proxyId);
      this.botProxyIds.delete(botId);
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

  protected async scheduleReconnect(
    botId: string,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.bots.get(botId);
    if (!entry) return;

    // Every failed (re)connect is fed into the circuit breaker and the health
    // tracker, so a bot that keeps failing trips its breaker and starts backing
    // off hard instead of hammering the provider.
    this.getCircuitBreaker(botId).recordFailure();
    this.getHealth(botId).recordFailure();
    // The proxy in use took a hit too, so the pool prefers healthier endpoints.
    const proxyId = this.botProxyIds.get(botId);
    if (proxyId) {
      this.proxies.reportFailure(proxyId);
      this.botProxyIds.delete(botId);
    }

    const attempt = entry.reconnectAttempts ?? 0;

    const existing = this.reconnectTimers.get(botId);
    if (existing) clearTimeout(existing);

    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[${this.platformName}] Giving up reconnecting ${botId} after ${attempt} attempts`,
      );
      this.getCircuitBreaker(botId).reset();
      this.getHealth(botId).reset();
      entry.reconnectAttempts = 0;
      // Drop the (already cleared) timer so the give-up is observable and the
      // bot can be retried by a later reconcile cycle.
      this.reconnectTimers.delete(botId);
      await this.markDisconnected(botId, `Gave up reconnecting after ${attempt} attempts`);
      return;
    }

    entry.reconnectAttempts = attempt + 1;

    if (this.getCircuitBreaker(botId).getState() === 'open') {
      // Circuit is open: do not hammer the provider. Wait out the cooldown and
      // then probe exactly once; a probe failure reopens the circuit.
      const delay = this.getCircuitBreaker(botId).remainingCooldownMs();
      console.log(
        `[${this.platformName}] Connection circuit open for ${botId}; retrying in ${delay}ms (attempt ${attempt + 1})`,
      );
      await this.writeLog(
        botId,
        'warn',
        `Connection circuit open; retrying in ${delay}ms (attempt ${attempt + 1})`,
      );
      const timer = setTimeout(() => {
        void this.attemptReconnect(botId, credentials);
      }, delay);
      this.reconnectTimers.set(botId, timer);
      return;
    }

    const failureRate = this.getHealth(botId).getFailureRate();
    const delay = calculateBackoff(attempt, failureRate);

    console.log(
      `[${this.platformName}] Scheduling reconnect for ${botId} in ${delay}ms (attempt ${attempt + 1})`,
    );

    await this.writeLog(botId, 'warn', `Reconnecting in ${delay}ms (attempt ${attempt + 1})`);

    const timer = setTimeout(() => {
      void this.attemptReconnect(botId, credentials);
    }, delay);

    this.reconnectTimers.set(botId, timer);
  }

  /**
   * Runs a single (re)connect attempt through the circuit breaker. In `open`
   * state nothing happens вЂ” the timer that fired was either stale or the
   * cooldown has not elapsed yet. In `half_open` the breaker consumes a probe
   * so recovery is limited to a handful of attempts.
   */
  private async attemptReconnect(
    botId: string,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    if (!this.getCircuitBreaker(botId).canAttempt()) return;
    try {
      await this.connect(credentials);
    } catch (err) {
      console.error(`[${this.platformName}] Reconnect failed for ${botId}:`, err);
      await this.scheduleReconnect(botId, credentials);
    }
  }

  async autoStartBots(): Promise<void> {
    try {
      const bots = await this.prisma.bot.findMany({
        where: { platform: this.platformName, status: { in: ['running', 'connecting'] } },
        include: { account: true },
      });

      console.log(`[${this.platformName}] Auto-starting ${bots.length} bots...`);

      await mapLimit(bots, AUTO_START_CONCURRENCY, async (bot) => {
        if (this.isConnected(bot.id)) return;
        // A reconnect timer is already pending for this bot; do not race it
        // with a second concurrent connect.
        if (this.reconnectTimers.has(bot.id)) return;
        // Circuit open for this bot: skip until the cooldown elapses, instead
        // of hitting the provider on every reconcile cycle.
        if (!this.getCircuitBreaker(bot.id).canAttempt()) {
          console.log(
            `[${this.platformName}] Connection circuit open for ${bot.id}; skipping auto-start`,
          );
          return;
        }

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

        this.applyProxy(bot.id, credentials);

        const entry = this.ensureBot(bot.id);
        entry.status = 'connecting';
        entry.instance = null;
        // Per-bot send budget from bot.config.rateLimitPerMinute, enforced by
        // assertOutboundAllowed. Falls back to the global outbound budget.
        entry.rateLimitPerMinute =
          typeof config.rateLimitPerMinute === 'number' ? config.rateLimitPerMinute : undefined;

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

  protected async assertOutboundAllowed(botId: string, actionType: string): Promise<void> {
    if (OUTBOUND_EXEMPT_ACTIONS.has(actionType)) return;

    // A configured per-bot budget overrides the global one, so a VIP bot can
    // burst while a cheap bot is throttled independently. Keyed per bot so each
    // bot's counter is its own sliding window (shared across replicas via Redis).
    const perMinute = this.bots.get(botId)?.rateLimitPerMinute;
    if (perMinute && perMinute > 0) {
      let limiter = this.botRateLimiters.get(botId);
      if (!limiter) {
        limiter = new RedisRateLimiter(
          outboundRedis,
          `bothive:outbound:${botId}:`,
          perMinute,
          60_000,
        );
        this.botRateLimiters.set(botId, limiter);
      }
      const allowed = await limiter.check(actionType);
      if (!allowed) {
        throw new Error(`Bot rate limit exceeded (${perMinute}/min) for ${actionType}`);
      }
      return;
    }

    const allowed = await outboundLimiter.check(`${botId}:${actionType}`);
    if (!allowed) {
      throw new Error(`Outbound rate limit exceeded for ${actionType}`);
    }
  }

  /** Reloads the proxy pool from the database (leader only, called on reconcile). */
  protected async refreshProxies(): Promise<void> {
    try {
      const model = this.prisma.proxy;
      if (!model) return;
      const rows = await model.findMany({ where: { enabled: true } });
      this.proxies.setProxies(
        rows.map((row) => {
          const url = decryptCredential(row.url) ?? '';
          return {
            id: row.id,
            url,
            type: row.type === 'socks5' ? 'socks5' : 'http',
            priority: row.priority,
            enabled: true,
            healthScore: row.healthScore,
            lastFailedAt: row.lastFailedAt ? row.lastFailedAt.toISOString() : undefined,
            requestsCount: row.requestsCount,
            failureCount: row.failureCount,
          };
        }),
      );
    } catch (err) {
      console.error(`[${this.platformName}] Proxy pool refresh failed:`, err);
    }
  }

  /**
   * Picks a healthy proxy from the pool and injects it into the platform
   * credentials (`proxy` / `proxyType`). Direct connections when the pool is
   * empty or everything is unhealthy.
   */
  protected applyProxy(botId: string, credentials: Record<string, unknown>): void {
    const proxy = this.proxies.selectProxy();
    if (!proxy) {
      this.botProxyIds.delete(botId);
      return;
    }
    credentials.proxy = proxy.url;
    credentials.proxyType = proxy.type;
    this.botProxyIds.set(botId, proxy.id);
  }

  /**
   * Rate-limited wrapper around the platform's `executeAction`. Both queue
   * `execute` jobs and script actions go through here, so a runaway script can
   * never flood a provider endpoint past the configured budget.
   */
  async executeRateLimited(
    botId: string,
    action: { type: string; payload: object },
  ): Promise<unknown> {
    await this.assertOutboundAllowed(botId, action.type);
    try {
      const result = await this.executeAction(botId, action);
      // Successful actions feed the health window (score 0-100 over 1h), which
      // in turn scales the reconnect backoff.
      this.getHealth(botId).recordSuccess();
      const entry = this.ensureBot(botId);
      entry.actionsSuccess = (entry.actionsSuccess ?? 0) + 1;
      return result;
    } catch (err) {
      this.getHealth(botId).recordFailure();
      const entry = this.ensureBot(botId);
      entry.actionsFailed = (entry.actionsFailed ?? 0) + 1;
      throw err;
    }
  }

  /** Counts one script execution (per event + interval runs) for metrics. */
  recordScriptExecution(botId: string): void {
    const entry = this.ensureBot(botId);
    entry.scriptExecutions = (entry.scriptExecutions ?? 0) + 1;
  }

  /** Counts one failed script action so alerting can watch the failure rate. */
  recordScriptError(botId: string): void {
    const entry = this.ensureBot(botId);
    entry.scriptErrors = (entry.scriptErrors ?? 0) + 1;
  }

  /**
   * Queue wait percentiles (seconds) from the rolling window, published with
   * the heartbeat and exposed as `bothive_queue_wait_seconds{quantile=...}`.
   */
  getWaitPercentiles(): { p50: number; p95: number; p99: number } {
    return this.waitTracker.percentiles();
  }

  /** The BullMQ job concurrency this worker runs with (exported via heartbeat). */
  getConcurrency(): number {
    return this.worker.opts.concurrency ?? 0;
  }

  private async processJob(job: Job<QueueJob>): Promise<void> {
    // Non-leaders never receive jobs (worker is paused), but guard anyway in
    // case a job was already in flight when leadership changed.
    if (!this.isLeader) {
      throw new Error(`[${this.platformName}] Not the leader; requeuing job ${job.id}`);
    }
    switch (job.data.type) {
      case 'connect': {
        const data = job.data.data as Record<string, unknown>;
        if (typeof job.data.botId === 'string') {
          this.applyProxy(job.data.botId, data);
        }
        await this.connect(data);
        return;
      }
      case 'disconnect':
        await this.disconnect(job.data.botId);
        return;
      case 'execute':
        await this.executeRateLimited(
          job.data.botId,
          job.data.data as { type: string; payload: object },
        );
        return;
      default:
        console.warn(`[${this.platformName}] Unknown job type: ${job.data.type}`);
    }
  }

  async start(): Promise<void> {
    await this.worker.waitUntilReady();
    // Guarantee the worker is paused before the leadership loop decides who may
    // resume it (the constructor pause may still be in flight).
    await this.worker.pause();
    console.log(
      `[${this.platformName}] Worker ready, concurrency: ${this.worker.opts.concurrency}`,
    );
    await this.startLeadership();
  }

  /**
   * Leader election: the instance that holds the Redis lease (`bothive:leader:<platform>`)
   * is the only one that consumes control jobs and keeps live connections, so
   * `--scale workers-X=N` yields HA failover instead of duplicate connections /
   * duplicate events. A lease is renewed every few seconds and expires after
   * `LEADER_TTL_MS`, so a dead leader is replaced by another replica.
   */
  async startLeadership(): Promise<void> {
    await leaderRedis
      .connect()
      .catch((err) => console.error(`[${this.platformName}] leaderRedis connect failed:`, err));

    await this.ensureLeadershipState();

    this.leaderTimer = setInterval(() => {
      void this.ensureLeadershipState().catch((err) =>
        console.error(`[${this.platformName}] Leadership loop error:`, err),
      );
    }, LEADER_CHECK_INTERVAL_MS);

    // Periodically reconnect bots that should be running but whose live
    // connection silently dropped (self-healing on the leader).
    this.reconcileTimer = setInterval(() => {
      if (this.isLeader) {
        void this.refreshProxies().catch((err) =>
          console.error(`[${this.platformName}] Proxy pool refresh error:`, err),
        );
        void this.autoStartBots().catch((err) =>
          console.error(`[${this.platformName}] Reconcile error:`, err),
        );
        void this.publishHealthScores().catch((err) =>
          console.error(`[${this.platformName}] Health publish error:`, err),
        );
      }
    }, RECONCILE_INTERVAL_MS);
  }

  private async ensureLeadershipState(): Promise<void> {
    const nowLeader = await this.tryAcquireLeadership();
    if (nowLeader === this.isLeader) return;

    this.isLeader = nowLeader;

    if (nowLeader) {
      console.log(`[${this.platformName}] Acquired leadership (instance ${this.instanceId})`);
      await this.worker.resume();
      await this.refreshProxies();
      await this.autoStartBots();
    } else {
      console.error(`[${this.platformName}] Lost leadership (instance ${this.instanceId})`);
      await this.worker.pause();
      this.clearReconnectTimers();
      await this.disconnectAll();
    }
  }

  private async tryAcquireLeadership(): Promise<boolean> {
    const key = LEADER_KEY_PREFIX + this.platformName;
    // NX: only take the lease when it is free (previous leader died/expired).
    const acquired = await leaderRedis.set(key, this.instanceId, 'PX', LEADER_TTL_MS, 'NX');
    if (acquired === 'OK') return true;
    // Already ours? Renew the TTL so we don't lose the lease while alive.
    const holder = await leaderRedis.get(key);
    if (holder === this.instanceId) {
      await leaderRedis.pexpire(key, LEADER_TTL_MS);
      return true;
    }
    return false;
  }

  private clearReconnectTimers(): void {
    for (const [, timer] of this.reconnectTimers) clearTimeout(timer);
    this.reconnectTimers.clear();
  }

  private async disconnectAll(): Promise<void> {
    for (const [botId] of this.bots) {
      try {
        await this.disconnect(botId);
      } catch (err) {
        console.error(`[${this.platformName}] Error disconnecting ${botId}:`, err);
      }
    }
  }

  async stopLeadership(): Promise<void> {
    if (this.leaderTimer) {
      clearInterval(this.leaderTimer);
      this.leaderTimer = undefined;
    }
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
    try {
      const key = LEADER_KEY_PREFIX + this.platformName;
      // Release the lease only if we still own it, so a takeover is not slowed
      // down by our expired-but-not-yet-cleaned key.
      const holder = await leaderRedis.get(key);
      if (holder === this.instanceId) await leaderRedis.del(key);
    } catch (err) {
      console.error(`[${this.platformName}] Failed to release leadership lease:`, err);
    }
    leaderRedis.disconnect();
    healthRedis.disconnect();
  }

  async shutdown(): Promise<void> {
    await this.stopLeadership();
    this.clearReconnectTimers();

    await this.worker.close(); // waits for running jobs up to 30s

    await this.disconnectAll();

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
