import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import { isWebhookUrlAllowed, captureError, FORBIDDEN_CODE_PATTERNS } from '@bothive/core';

const MAX_DELAY_MS = 300_000;
const MAX_CUSTOM_CODE = 4000;
const MAX_CUSTOM_EXPRESSION = 500;
const SCRIPT_SYNC_TIMEOUT_MS = 1000;
const SCRIPT_ASYNC_TIMEOUT_MS = 5000;
// Cap the heap a script can allocate in a vm context (checked on the thread's
// own heap, so a runaway `a = a.concat(a)` is killed before it OOMs the host).
const SCRIPT_VM_HEAP_MB = 64;
const SCRIPT_VM_RESOURCE_LIMITS = { maxOldGenerationSizeMb: SCRIPT_VM_HEAP_MB };
// resourceLimits are bound on the context (the @types/node 26 vm typings no
// longer surface the option, but Node still honours it on createContext); the
// heap cap then travels with every script executed in that context.
const scriptContextOptions = {
  codeGeneration: { strings: false, wasm: false },
  resourceLimits: SCRIPT_VM_RESOURCE_LIMITS,
} as unknown as vm.CreateContextOptions;

/**
 * Custom `type: 'custom'` actions run inside a worker thread, not in-process.
 * `vm.runInContext({ timeout })` only bounds the synchronous portion of a script
 * — after an `await` the continuation runs on the event loop and the vm timeout
 * no longer applies, so `await ...; while(true){}` would pin the whole worker
 * process. Inside a worker thread we can call `worker.terminate()`, which
 * actually kills the runaway thread. The worker gets no environment variables
 * (`env: {}`), so even a full vm escape inside the thread cannot read host
 * secrets, and its only contact with the host is the api RPC below.
 */
const SANDBOX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

const { code, snapshot, methodNames, syncTimeoutMs } = workerData;

const VM_RESOURCE_LIMITS = { maxOldGenerationSizeMb: ${SCRIPT_VM_HEAP_MB} };

let callSeq = 0;
const pending = new Map();

parentPort.on('message', (msg) => {
  if (msg.type !== 'result') return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.value);
  else p.reject(new Error(msg.error));
});

function callApi(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++callSeq;
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'call', id, method, args });
  });
}

function toSafeSnapshot(value) {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(toSafeSnapshot);
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const k of Object.keys(value)) out[k] = toSafeSnapshot(value[k]);
    return Object.freeze(out);
  }
  return value;
}

const apiBridge = Object.create(null);
for (const m of methodNames) {
  apiBridge[m] = function () { return callApi(m, Array.prototype.slice.call(arguments)); };
}

const sandbox = Object.assign(Object.create(null), {
  ctx: toSafeSnapshot(snapshot),
  __bothiveHostApi: apiBridge,
  __bothiveSanitize: toSafeSnapshot,
});
const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, resourceLimits: VM_RESOURCE_LIMITS });

vm.runInContext(
  '(function (__bothiveHostApi, sanitize) {' +
  '  var methodNames = ' + JSON.stringify(methodNames) + ';' +
  '  function forwardResult(result) {' +
  '    if (result && typeof result.then === "function") { return result.then(function (value) { return sanitize(value); }); }' +
  '    return sanitize(result);' +
  '  }' +
  '  function safeFetch() {' +
  '    var promise = __bothiveHostApi.fetch.apply(__bothiveHostApi, arguments);' +
  '    return promise.then(function (res) {' +
  '      var headers = {};' +
  '      try { if (res && res.headers) { for (var k in res.headers) { if (Object.prototype.hasOwnProperty.call(res.headers, k)) headers[k] = res.headers[k]; } } } catch (e) { headers = {}; }' +
  '      var text = (res && typeof res.text === "string") ? res.text : "";' +
  '      return Object.freeze(Object.assign(Object.create(null), {' +
  '        ok: sanitize(res && res.ok),' +
  '        status: sanitize(res && res.status),' +
  '        statusText: sanitize(res && res.statusText),' +
  '        headers: sanitize(headers),' +
  '        json: function () { try { return Promise.resolve(JSON.parse(text)); } catch (e) { return Promise.reject(e); } },' +
  '        text: function () { return Promise.resolve(text); },' +
  '      }));' +
  '    });' +
  '  }' +
  '  var bridge = new Proxy(Object.create(null), {' +
  '    get: function (_target, prop) {' +
  '      if (typeof prop === "symbol" || methodNames.indexOf(prop) === -1) return undefined;' +
  '      if (prop === "fetch") return safeFetch;' +
  '      return function () {' +
  '        return forwardResult(__bothiveHostApi[prop].apply(__bothiveHostApi, arguments));' +
  '      };' +
  '    },' +
  '    has: function (_target, prop) { return methodNames.indexOf(prop) !== -1; },' +
  '    ownKeys: function () { return methodNames; },' +
  '    getOwnPropertyDescriptor: function () { return { configurable: true, enumerable: true, writable: true }; },' +
  '  });' +
  '  this.api = bridge;' +
  '  this.ctx = Object.assign(Object.create(null), this.ctx, { api: bridge });' +
  '}).call(this, __bothiveHostApi, __bothiveSanitize);',
  context,
);
delete sandbox.__bothiveHostApi;
delete sandbox.__bothiveSanitize;

(async () => {
  try {
    // resourceLimits must be bound at Script creation to enforce the vm heap cap.
    const define = new vm.Script('this.__run = async (ctx) => {\n' + code + '\n}', { resourceLimits: VM_RESOURCE_LIMITS });
    define.runInContext(context, { timeout: syncTimeoutMs });
    const invoke = new vm.Script('__run(ctx)', { resourceLimits: VM_RESOURCE_LIMITS });
    const result = invoke.runInContext(context, { timeout: syncTimeoutMs });
    if (result && typeof result.then === 'function') await result;
    parentPort.postMessage({ type: 'done', ok: true });
  } catch (err) {
    parentPort.postMessage({ type: 'done', ok: false, error: String((err && err.message) || err) });
  }
})();
`;
const FORBIDDEN_EXPRESSION_PATTERNS = [
  /\basync\b/,
  /\bawait\b/,
  /new\s+Promise\b/,
  /\.then\s*\(/,
  /\.catch\s*\(/,
];

// Live worker_threads running custom script actions. A leak (threads that are
// never terminated) shows up here as a growing count, which the heartbeat
// exposes as `bothive_worker_sandbox_workers` and alerting watches for.
let activeSandboxWorkers = 0;
// Hard cap on concurrent sandbox worker threads to prevent OOM.  Each thread
// allocates up to 128 MB, so 10 threads = ~1.28 GB max.  The cap is generous
// enough for normal workloads but prevents a runaway script from spawning
// hundreds of threads and exhausting host memory.
const MAX_SANDBOX_WORKERS = 10;

interface ScriptStep {
  type:
    | 'reply'
    | 'react'
    | 'forward'
    | 'custom'
    | 'increment_counter'
    | 'if'
    | 'log'
    | 'delay'
    | 'webhook'
    | 'random_reply'
    | 'say';
  payload?: Record<string, unknown>;
  condition?: ScriptCondition;
  actions?: ScriptStep[];
}

interface ScriptCondition {
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'regex' | 'exists';
  field: string;
  value?: unknown;
}

export interface ScriptConfig {
  /** Stable identifier (DB row id) so several scripts may share one trigger. */
  id?: string;
  trigger: string;
  filters?: ScriptFilter[];
  actions: ScriptStep[];
  variables?: Record<string, unknown>;
  /** Minimum seconds between firings (anti-spam / anti-loop). 0 or undefined = no limit. */
  cooldown?: number;
  /** Run this script periodically (seconds). Used with a synthetic 'interval' event. */
  interval?: number;
  /**
   * Hard wall-clock budget for the whole action chain, in milliseconds. A script
   * that exceeds it (many reply/delay steps) is stopped before the next step.
   * Custom actions additionally have their own worker-thread timeout. 0 or
   * undefined = no global limit.
   */
  maxExecutionMs?: number;
}

interface ScriptFilter {
  type: 'regex' | 'keyword' | 'role' | 'custom';
  field?: string;
  value: string;
}

interface ExecutionContext {
  botId: string;
  platform: string;
  event: Record<string, unknown>;
  variables: Map<string, unknown>;
  counters: Map<string, number>;
  api: ScriptApi;
  /** Absolute timestamp at which the action chain must stop (from maxExecutionMs). */
  deadline?: number;
  /**
   * Set when any action in this run fails. Scripts are counted once per RUN
   * (`scriptErrors`), not once per failing action, so the failure rate has a
   * consistent denominator with `scriptExecutions` (one per run).
   */
  scriptFailed?: boolean;
}

export interface ScriptApi {
  sendMessage: (
    chatId: string | number,
    text: string,
    opts?: Record<string, unknown>,
  ) => Promise<unknown>;
  sendPhoto: (chatId: string | number, photo: string, caption?: string) => Promise<unknown>;
  deleteMessage: (chatId: string | number, messageId: number) => Promise<unknown>;
  say: (channel: string, message: string) => Promise<unknown>;
  timeout: (channel: string, user: string, seconds: number, reason?: string) => Promise<unknown>;
  tweet: (text: string) => Promise<unknown>;
  reply: (text: string, tweetId: string) => Promise<unknown>;
  react: (payload: Record<string, unknown>) => Promise<unknown>;
  getPrice?: (symbol: string) => Promise<unknown>;
  getCandles?: (symbol: string, interval?: string, limit?: number) => Promise<unknown>;
  getBalance?: (asset: string) => Promise<unknown>;
  marketBuy?: (symbol: string, amountUsdt: number) => Promise<unknown>;
  marketSell?: (symbol: string, quantity: number) => Promise<unknown>;
  getWallet?: () => Promise<unknown>;
  log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  remember?: <T>(key: string, value: T, ttl?: number) => Promise<unknown>;
  recall?: <T>(key: string) => Promise<T | undefined>;
  forget?: (key: string) => Promise<unknown>;
}

export class ScriptEngine {
  private scripts: Map<string, ScriptConfig> = new Map();
  /**
   * Index of scripts by `${botId}:${trigger}`, so an event never scans the
   * whole `scripts` map (a deployment can hold thousands of scripts; the
   * old `[...this.scripts].filter(key.startsWith(...))` copied and walked
   * all of them on every message).
   */
  private byTrigger: Map<string, ScriptConfig[]> = new Map();
  private counters: Map<string, Map<string, number>> = new Map();
  private cooldowns: Map<string, number> = new Map();

  /**
   * Invoked once per failed script run (a run that had at least one failing
   * action, or that hit its maxExecutionMs deadline) — the same events that go
   * to captureError — so the workers process can feed the
   * `bothive_bot_script_errors_total` metric and its failure-rate alert. One
   * invocation per run, matching `recordScriptExecution`'s one-per-run count.
   */
  onScriptError?: (botId: string) => void;

  private notifyScriptError(botId: string): void {
    try {
      this.onScriptError?.(botId);
    } catch {
      // The callback is purely observational; never break script execution.
    }
  }

  /** Number of live sandbox worker threads (custom script actions). */
  sandboxWorkerCount(): number {
    return activeSandboxWorkers;
  }

  /** Map key for a script: bot + trigger (+ script id when present). */
  private scriptKey(botId: string, script: ScriptConfig): string {
    return script.id ? `${botId}:${script.trigger}:${script.id}` : `${botId}:${script.trigger}`;
  }

  /** Index key for a bot's trigger: every script with this key matches its events. */
  private triggerKey(botId: string, trigger: string): string {
    return `${botId}:${trigger}`;
  }

  /** Rebuilds the trigger index from the scripts map (unregister/clear paths). */
  private rebuildIndex(): void {
    this.byTrigger.clear();
    for (const [key, config] of this.scripts) {
      const parts = key.split(':');
      const tKey = this.triggerKey(parts[0], parts[1]);
      const list = this.byTrigger.get(tKey) ?? [];
      list.push(config);
      this.byTrigger.set(tKey, list);
    }
  }

  register(botId: string, config: ScriptConfig): void {
    // Several scripts may legitimately share a trigger (different filters /
    // actions); the id disambiguates them so register() never overwrites.
    const key = this.scriptKey(botId, config);
    this.scripts.set(key, config);

    // Re-registering the same script (script-sync reload) must not leave a
    // duplicate entry in the index or the script would fire twice per event.
    const tKey = this.triggerKey(botId, config.trigger);
    const list = this.byTrigger.get(tKey) ?? [];
    const deduped = list.filter((existing) => this.scriptKey(botId, existing) !== key);
    deduped.push(config);
    this.byTrigger.set(tKey, deduped);

    if (!this.counters.has(botId)) {
      this.counters.set(botId, new Map());
    }
  }

  unregister(botId: string): void {
    for (const [key] of this.scripts) {
      if (key === botId || key.startsWith(botId + ':')) this.scripts.delete(key);
    }
    this.rebuildIndex();
    this.counters.delete(botId);
    this.cooldowns.delete(botId);
  }

  clear(): void {
    this.scripts.clear();
    this.byTrigger.clear();
    this.counters.clear();
    this.cooldowns.clear();
  }

  intervalBots(): string[] {
    const bots = new Set<string>();
    for (const [key, script] of this.scripts) {
      if (script.interval && script.interval > 0) {
        bots.add(key.split(':')[0]);
      }
    }
    return [...bots];
  }

  /** Cheap guard: whether any script matches this bot+trigger (avoids building
   * the script API bridge for events that no script is registered for). */
  hasMatch(botId: string, eventType: string): boolean {
    return (this.byTrigger.get(this.triggerKey(botId, eventType))?.length ?? 0) > 0;
  }

  async execute(botId: string, event: Record<string, unknown>, api: ScriptApi): Promise<void> {
    const eventType = event.type as string;

    // Share one counter map across every script of this bot so parallel runs
    // increment the same counters instead of each seeing a fresh copy.
    if (!this.counters.has(botId)) this.counters.set(botId, new Map());

    const matching = this.byTrigger.get(this.triggerKey(botId, eventType)) ?? [];
    // Scripts of one bot are independent — run them concurrently so one slow
    // script does not delay the others on the same event.
    await Promise.allSettled(matching.map((script) => this.runScript(script, botId, event, api)));
  }

  /** Run a single script config once, bypassing cooldown (used for manual tests). */
  async executeOnce(
    script: ScriptConfig,
    botId: string,
    event: Record<string, unknown>,
    api: ScriptApi,
  ): Promise<void> {
    await this.runScript(script, botId, event, api, true);
  }

  private async runScript(
    script: ScriptConfig,
    botId: string,
    event: Record<string, unknown>,
    api: ScriptApi,
    ignoreCooldown = false,
  ): Promise<void> {
    const key = this.scriptKey(botId, script);

    if (!ignoreCooldown && script.cooldown && script.cooldown > 0) {
      const now = Date.now();
      if (now - (this.cooldowns.get(key) ?? 0) < script.cooldown * 1000) return;
      // Set the cooldown BEFORE the first await so that a second event arriving
      // in the same event-loop tick (e.g. from a batch Redis XREAD or a
      // reconnection replay) sees the fresh timestamp and is blocked.
      this.cooldowns.set(key, now);
    }

    const ctx: ExecutionContext = {
      botId,
      platform: event.platform as string,
      event,
      variables: new Map(Object.entries(script.variables ?? {})),
      counters: this.counters.get(botId) ?? new Map(),
      api,
    };
    if (!this.counters.has(botId)) this.counters.set(botId, ctx.counters);
    if (script.maxExecutionMs && script.maxExecutionMs > 0) {
      ctx.deadline = Date.now() + script.maxExecutionMs;
    }

    if (!this.matchesFilters(script.filters ?? [], ctx)) return;

    await this.runActions(script.actions, ctx);

    if (ctx.deadline !== undefined && Date.now() >= ctx.deadline) {
      console.warn(
        `[Script ${botId}] Exceeded maxExecutionMs=${script.maxExecutionMs} and was stopped`,
      );
      ctx.scriptFailed = true;
      await ctx.api
        .log(
          'warn',
          `Script exceeded its maxExecutionMs (${script.maxExecutionMs}ms) and was stopped`,
        )
        .catch(() => {});
    }

    // Count the run once, not per failing action, so the error counter has a
    // consistent denominator with the one-per-run execution counter.
    if (ctx.scriptFailed) this.notifyScriptError(botId);
  }

  private matchesFilters(filters: ScriptFilter[], ctx: ExecutionContext): boolean {
    if (filters.length === 0) return true;

    const text = (ctx.event.text ?? ctx.event.message ?? '') as string;

    return filters.every((filter) => {
      switch (filter.type) {
        case 'role': {
          const target = filter.field
            ? ((resolvePath(ctx.event, filter.field) as string) ?? '')
            : ((ctx.event.role as string) ?? '');
          return String(target).toLowerCase() === String(filter.value).toLowerCase();
        }
        case 'regex': {
          const target = filter.field
            ? ((resolvePath(ctx.event, filter.field) as string) ?? '')
            : text;
          if (filter.value.length > 500) return false;
          const compiled = cachedRegex(filter.value);
          return compiled ? compiled.test(target) : false;
        }
        case 'keyword': {
          const target = filter.field
            ? ((resolvePath(ctx.event, filter.field) as string) ?? '')
            : text;
          return target.toLowerCase().includes(filter.value.toLowerCase());
        }
        case 'custom':
          if (!isExpressionAllowed(filter.value)) return false;
          try {
            return runSandboxExpression(filter.value, ctx);
          } catch {
            return false;
          }
        default:
          return true;
      }
    });
  }

  private async runActions(actions: ScriptStep[], ctx: ExecutionContext): Promise<void> {
    for (const step of actions) {
      // Respect the global execution budget between steps: a script that burns
      // its maxExecutionMs (many sends/delays) is stopped before the next step
      // instead of running for minutes.
      if (ctx.deadline !== undefined && Date.now() >= ctx.deadline) break;
      try {
        if (step.condition && !this.evaluateCondition(step.condition, ctx)) continue;

        switch (step.type) {
          case 'reply':
            await this.handleReply(step, ctx);
            break;
          case 'random_reply':
            await this.handleRandomReply(step, ctx);
            break;
          case 'say': {
            const channel = step.payload?.channel as string;
            const text = interpolate(String(step.payload?.message ?? ''), ctx);
            if (channel && text) await ctx.api.say(channel, text);
            break;
          }
          case 'react':
            await this.handleReact(step, ctx);
            break;
          case 'forward':
            await this.handleForward(step, ctx);
            break;
          case 'increment_counter':
            await this.handleIncrementCounter(step, ctx);
            break;
          case 'if':
            if (step.actions) await this.runActions(step.actions, ctx);
            break;
          case 'log':
            console.log(`[Script ${ctx.botId}] ${step.payload?.message ?? ''}`);
            await ctx.api.log(
              'info',
              (step.payload?.message as string) ?? 'Script log',
              step.payload as Record<string, unknown>,
            );
            break;
          case 'delay':
            await new Promise((r) =>
              setTimeout(r, Math.min((step.payload?.ms as number) ?? 1000, MAX_DELAY_MS)),
            );
            break;
          case 'webhook':
            if (step.payload?.url) {
              const url = step.payload.url as string;
              if (isWebhookUrlAllowed(url)) {
                const { url: _url, ...bodyPayload } = step.payload;
                await ctx.api.fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ data: bodyPayload, ctx: webhookCtxSnapshot(ctx) }),
                });
              } else {
                console.warn(
                  `[Script ${ctx.botId}] Blocked webhook action to disallowed URL: ${url}`,
                );
              }
            }
            break;
          case 'custom':
            if (isCodeAllowed((step.payload?.code as string) ?? '')) {
              try {
                await runSandboxAction((step.payload?.code as string) ?? '', ctx);
              } catch (err) {
                console.error(`[Script] Custom action error:`, err);
                captureError(err, { botId: ctx.botId, action: 'custom', trigger: ctx.event?.type });
                ctx.scriptFailed = true;
              }
            } else {
              console.warn(`[Script ${ctx.botId}] Blocked custom action with forbidden code`);
            }
            break;
        }
      } catch (err) {
        // Isolate failing actions so the remaining steps still run.
        console.error(`[Script ${ctx.botId}] Action "${step.type}" failed:`, err);
        await ctx.api.log('error', `Script action "${step.type}" failed`).catch(() => {});
        captureError(err, { botId: ctx.botId, action: step.type, trigger: ctx.event?.type });
        ctx.scriptFailed = true;
      }
    }
  }

  private async handleReply(step: ScriptStep, ctx: ExecutionContext): Promise<void> {
    const text = interpolate((step.payload?.text as string) ?? '', ctx);
    const event = ctx.event as Record<string, unknown>;
    const chatId = String(step.payload?.chatId ?? event.chatId ?? event.id ?? '');
    if (chatId && chatId !== 'undefined') {
      await ctx.api.sendMessage(chatId, text, step.payload);
    } else if (event.channel) {
      await ctx.api.say(event.channel as string, text);
    }
  }

  private async handleRandomReply(step: ScriptStep, ctx: ExecutionContext): Promise<void> {
    const variants = step.payload?.variants;
    if (!Array.isArray(variants) || variants.length === 0) return;

    const picked = variants[Math.floor(Math.random() * variants.length)];
    const text = interpolate(String(picked ?? ''), ctx);
    const event = ctx.event as Record<string, unknown>;
    const chatId = String(step.payload?.chatId ?? event.chatId ?? event.id ?? '');
    if (chatId && chatId !== 'undefined') {
      await ctx.api.sendMessage(chatId, text, step.payload);
    } else if (event.channel) {
      await ctx.api.say(event.channel as string, text);
    }
  }

  private async handleReact(step: ScriptStep, ctx: ExecutionContext): Promise<void> {
    const event = ctx.event as Record<string, unknown>;
    const payload: Record<string, unknown> = { ...(step.payload ?? {}) };

    if (!payload.chatId && event.chatId) payload.chatId = event.chatId;
    if (!payload.messageId && event.messageId) payload.messageId = event.messageId;
    if (!payload.messageId && event.tweetId) payload.messageId = event.tweetId;
    if (!payload.userId && event.authorId) payload.userId = event.authorId;
    if (!payload.reaction) payload.reaction = '👍';

    if (!payload.messageId && !payload.chatId) return;

    try {
      await ctx.api.react(payload);
      await ctx.api.log('info', `Reacted on ${event.type as string} event`, payload);
    } catch (err) {
      console.error(`[Script] React failed for ${ctx.botId}:`, err);
      captureError(err, { botId: ctx.botId, action: 'react', trigger: ctx.event?.type });
      ctx.scriptFailed = true;
    }
  }

  private async handleForward(step: ScriptStep, ctx: ExecutionContext): Promise<void> {
    const target = step.payload?.to as string;
    if (!target) return;

    await ctx.api.sendMessage(target, JSON.stringify(ctx.event, null, 2));
    await ctx.api.log('info', `Forwarded event to ${target}`);
  }

  private async handleIncrementCounter(step: ScriptStep, ctx: ExecutionContext): Promise<void> {
    const name = step.payload?.name as string;
    if (!name) return;

    const current = ctx.counters.get(name) ?? 0;
    ctx.counters.set(name, current + 1);
  }

  private evaluateCondition(condition: ScriptCondition, ctx: ExecutionContext): boolean {
    let left: unknown;
    if (condition.field.startsWith('counters.')) {
      left = ctx.counters.get(condition.field.slice('counters.'.length));
    } else if (condition.field.startsWith('variables.')) {
      left = ctx.variables.get(condition.field.slice('variables.'.length));
    } else {
      left = resolvePath(ctx.event, condition.field) as string | number | undefined;
      if (left === undefined)
        left = ctx.variables.get(condition.field) as string | number | undefined;
      if (left === undefined)
        left = ctx.counters.get(condition.field) as string | number | undefined;
    }

    switch (condition.operator) {
      case 'eq':
        return left === condition.value;
      case 'ne':
        return left !== condition.value;
      case 'gt':
        return Number(left) > Number(condition.value);
      case 'gte':
        return Number(left) >= Number(condition.value);
      case 'lt':
        return Number(left) < Number(condition.value);
      case 'lte':
        return Number(left) <= Number(condition.value);
      case 'contains':
        return String(left).includes(String(condition.value));
      case 'regex': {
        const pattern = String(condition.value);
        if (pattern.length > 500) return false;
        const compiled = cachedRegex(pattern);
        return compiled ? compiled.test(String(left)) : false;
      }
      case 'exists':
        return left !== undefined && left !== null;
      default:
        return true;
    }
  }
}

/**
 * Recursively converts a value into a null-prototype, deep-frozen, JSON-safe
 * snapshot. Null-prototype objects expose no `constructor`/`__proto__` chain, so
 * sandboxed code cannot walk `ctx.constructor.constructor` to reach host intrinsics
 * through the data it is given. Functions are dropped (replaced with undefined):
 * they are never legitimate snapshot data and would otherwise leak host callables.
 */
function toSafeSnapshot(value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(toSafeSnapshot);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value)) out[k] = toSafeSnapshot(v);
    return Object.freeze(out);
  }
  return value;
}

/** Builds a JSON-safe, read-only snapshot of the script context for the VM. */
function ctxSnapshot(ctx: ExecutionContext): Record<string, unknown> {
  return toSafeSnapshot({
    botId: ctx.botId,
    platform: ctx.platform,
    event: ctx.event,
    variables: Object.fromEntries(ctx.variables),
    counters: Object.fromEntries(ctx.counters),
  }) as Record<string, unknown>;
}

/** Snapshot used when a webhook action forwards context to an external server. */
function webhookCtxSnapshot(ctx: ExecutionContext): Record<string, unknown> {
  return ctxSnapshot(ctx);
}

/**
 * Names of the callable methods the host exposes to a sandbox. This is the
 * allow-list the `api` Proxy forwards to (see `runSandboxContext`).
 */
function apiMethodNames(api: unknown): string[] {
  const record = api as Record<string, unknown>;
  return Object.keys(record).filter((key) => typeof record[key] === 'function');
}

/**
 * Builds the VM context for custom filter expressions.
 *
 * Custom *actions* run in a worker thread (see `runSandboxAction`); this
 * in-process context is only used by sync filter expressions, which are fully
 * bounded by the `vm.runInContext({ timeout })` watchdog (a filter has no
 * top-level `await`, so nothing can outlive the synchronous evaluation).
 *
 * The expression sees:
 *  - `ctx`: a null-prototype, deep-frozen snapshot of event/variables/counters,
 *    plus an `api` bridge (see below).
 *  - `api`: a Proxy that forwards ONLY the known host method names to the host
 *    implementation. The forwarding wrappers are created inside the VM realm, so
 *    `api.<fn>.constructor` is the VM's Function, which `codeGeneration:
 *    { strings: false }` disables. This closes the `api.<fn>["cons"+"tructor"]
 *    ("return process")()` escape that a direct pass-through of host functions
 *    allowed. Host functions are referenced only from the wrapper closures and
 *    are unreachable as values from script code.
 *
 * Return values are also sanitized through `toSafeSnapshot` (host objects are
 * converted to null-prototype, deep-frozen plain data), so
 * `(await api.sendMessage(...)).constructor.constructor("return process")()`
 * cannot reach the host realm through resolved results either. `fetch` is the one
 * exception: it returns a response wrapper whose `json()`/`text()` are created
 * inside the VM realm, so no host callable leaks to the script.
 */
interface CachedExpression {
  script: vm.Script;
  context: vm.Context;
  sandbox: Record<string, unknown>;
}

/**
 * Bounded cache of compiled custom-filter expressions. Creating a vm context
 * (plus the bridge IIFE and the Script compile) costs real time, and a custom
 * filter runs on every matching event — rebuilding it each time would dominate
 * the script path. Entries are keyed by bot + expression because the api
 * bridge closures capture the first bot's host api: reusing a context across
 * bots would route script calls to the wrong bot. Evaluations are fully
 * synchronous (async constructs are banned), so reusing one context per key
 * cannot interleave.
 */
const MAX_CACHED_EXPRESSIONS = 256;
const expressionCache = new Map<string, CachedExpression>();

/**
 * Bounded cache of compiled regex filters. Filters are static per script, so
 * recompiling `new RegExp(...)` on every matching event is pure waste.
 */
const MAX_CACHED_REGEXES = 512;
const regexCache = new Map<string, RegExp | null>();

/**
 * Rejects regex patterns that are known to cause catastrophic backtracking
 * (ReDoS).  Nested quantifiers like `(a+)+`, `(a*)*`, `(a?)*`, and
 * `(a{1,})+` are the primary vectors.  This is a heuristic — it won't catch
 * every possible ReDoS, but it blocks the most common and dangerous patterns
 * while allowing virtually all legitimate filter regexes through.
 */
function looksDangerous(pattern: string): boolean {
  // Strip escaped characters so we don't false-positive on literal parens/brackets.
  const stripped = pattern.replace(/\\./g, '__');
  // Nested quantifiers: quantifier inside a group followed by another quantifier.
  // Matches: (…+)+, (…*)*, (…?)*, (…{m,n})+, etc.
  if (/\([^\)]*[+*?{][^\)]*\)[+*?{]/.test(stripped)) return true;
  // Backreferences to groups with quantifiers can also blow up, but they're
  // rare enough in filter patterns that we skip them for now.
  return false;
}

function cachedRegex(pattern: string): RegExp | null {
  const existing = regexCache.get(pattern);
  if (existing !== undefined) return existing;
  if (looksDangerous(pattern)) {
    regexCache.set(pattern, null);
    return null;
  }
  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern, 'i');
  } catch {
    regexCache.set(pattern, null);
    return null;
  }
  if (regexCache.size >= MAX_CACHED_REGEXES) {
    const oldest = regexCache.keys().next().value as string | undefined;
    if (oldest !== undefined) regexCache.delete(oldest);
  }
  regexCache.set(pattern, compiled);
  return compiled;
}

/**
 * Builds the VM context for custom filter expressions.
 *
 * Custom *actions* run in a worker thread (see `runSandboxAction`); this
 * in-process context is only used by sync filter expressions, which are fully
 * bounded by the `vm.runInContext({ timeout })` watchdog (a filter has no
 * top-level `await`, so nothing can outlive the synchronous evaluation).
 *
 * The expression sees:
 *  - `ctx`: a null-prototype, deep-frozen snapshot of event/variables/counters,
 *    plus an `api` bridge (see below).
 *  - `api`: a Proxy that forwards ONLY the known host method names to the host
 *    implementation. The forwarding wrappers are created inside the VM realm, so
 *    `api.<fn>.constructor` is the VM's Function, which `codeGeneration:
 *    { strings: false }` disables. This closes the `api.<fn>["cons"+"tructor"]
 *    ("return process")()` escape that a direct pass-through of host functions
 *    allowed. Host functions are referenced only from the wrapper closures and
 *    are unreachable as values from script code.
 *
 * Return values are also sanitized through `toSafeSnapshot` (host objects are
 * converted to null-prototype, deep-frozen plain data), so
 * `(await api.sendMessage(...)).constructor.constructor("return process")()`
 * cannot reach the host realm through resolved results either. `fetch` is the one
 * exception: it returns a response wrapper whose `json()`/`text()` are created
 * inside the VM realm, so no host callable leaks to the script.
 */
function createExpressionSandbox(expression: string, ctx: ExecutionContext): CachedExpression {
  const api = ctx.api as unknown as Record<string, unknown>;
  const methodNames = apiMethodNames(api);

  const sandbox: Record<string, unknown> = Object.assign(Object.create(null), {
    ctx: ctxSnapshot(ctx),
  });
  const context = vm.createContext(sandbox, scriptContextOptions);

  // Pass the host api and sanitizer into an IIFE inside the VM realm; the
  // closures capture the parameter bindings, not the globals, so the globals can
  // be removed afterwards.
  sandbox.__bothiveHostApi = api;
  sandbox.__bothiveSanitize = toSafeSnapshot;
  vm.runInContext(
    `(function (__bothiveHostApi, sanitize) {
      var methodNames = ${JSON.stringify(methodNames)};
      function forwardResult(result) {
        if (result && typeof result.then === 'function') {
          return result.then(function (value) { return sanitize(value); });
        }
        return sanitize(result);
      }
      function safeFetch() {
        var promise = __bothiveHostApi.fetch.apply(__bothiveHostApi, arguments);
        return promise.then(function (res) {
          var headers = {};
          try { headers = Object.fromEntries(res.headers.entries()); } catch (e) { headers = {}; }
          return Object.freeze(Object.assign(Object.create(null), {
            ok: sanitize(res.ok),
            status: sanitize(res.status),
            statusText: sanitize(res.statusText),
            headers: sanitize(headers),
            json: function () { return Promise.resolve(res.json()).then(sanitize); },
            text: function () { return Promise.resolve(res.text()).then(sanitize); },
          }));
        });
      }
      var bridge = new Proxy(Object.create(null), {
        get: function (_target, prop) {
          if (typeof prop === 'symbol' || methodNames.indexOf(prop) === -1) return undefined;
          if (prop === 'fetch') return safeFetch;
          return function () {
            return forwardResult(__bothiveHostApi[prop].apply(__bothiveHostApi, arguments));
          };
        },
        has: function (_target, prop) { return methodNames.indexOf(prop) !== -1; },
        ownKeys: function () { return methodNames; },
        getOwnPropertyDescriptor: function () { return { configurable: true, enumerable: true, writable: true }; },
      });
      this.api = bridge;
      // Keep ctx.api working for existing scripts: same bridge, not host fns.
      this.ctx = Object.assign(Object.create(null), this.ctx, { api: bridge });
    }).call(this, __bothiveHostApi, __bothiveSanitize);`,
    context,
  );
  delete sandbox.__bothiveHostApi;
  delete sandbox.__bothiveSanitize;

  const script = new vm.Script(`(${expression})`);
  return { script, context, sandbox };
}

function isCodeAllowed(code: string): boolean {
  if (code.length > MAX_CUSTOM_CODE) return false;
  for (const pattern of FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(code)) return false;
  }
  return true;
}

/** Filter expressions must be synchronous — see FORBIDDEN_EXPRESSION_PATTERNS. */
function isExpressionAllowed(expression: string): boolean {
  if (expression.length > MAX_CUSTOM_EXPRESSION) return false;
  for (const pattern of FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(expression)) return false;
  }
  for (const pattern of FORBIDDEN_EXPRESSION_PATTERNS) {
    if (pattern.test(expression)) return false;
  }
  return true;
}

function runSandboxExpression(expression: string, ctx: ExecutionContext): unknown {
  const cacheKey = `${ctx.botId}\u0000${expression}`;
  let entry = expressionCache.get(cacheKey);
  if (entry) {
    // Cached expressions were already allow-scanned at compile time; skip the
    // pattern scan on every event (custom filters evaluate per event).
    return runCachedExpression(entry, ctx);
  }
  if (!isExpressionAllowed(expression)) {
    throw new Error('forbidden expression construct');
  }
  if (expressionCache.size >= MAX_CACHED_EXPRESSIONS) {
    // FIFO eviction: Maps iterate in insertion order, the first key is oldest.
    const oldest = expressionCache.keys().next().value as string | undefined;
    if (oldest !== undefined) expressionCache.delete(oldest);
  }
  entry = createExpressionSandbox(expression, ctx);
  expressionCache.set(cacheKey, entry);
  return runCachedExpression(entry, ctx);
}

function runCachedExpression(
  entry: { script: vm.Script; context: vm.Context; sandbox: Record<string, unknown> },
  ctx: ExecutionContext,
): unknown {
  // Refresh the per-event data; the sandbox object is the context's global
  // proxy, so assigning ctx rebinds the global for the cached context. This is
  // safe because evaluations are synchronous (no interleaving possible).
  entry.sandbox.ctx = ctxSnapshot(ctx);
  const result = entry.script.runInContext(entry.context, {
    timeout: SCRIPT_SYNC_TIMEOUT_MS,
  });
  // A thenable result would run its continuation unmanaged on the main thread
  // (the vm timeout only bounds the synchronous part) — treat it as no-match.
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    throw new Error('expression returned a promise');
  }
  return result;
}

/**
 * Runs a custom `type: 'custom'` action inside a worker thread.
 *
 * The old in-process `vm.runInContext({ timeout })` only bounds the synchronous
 * portion of a script — after an `await` the continuation runs on the event
 * loop and the vm watchdog no longer applies, so `await x; while(true){}` would
 * pin the whole worker process. Inside a child worker thread we can call
 * `worker.terminate()`, which actually kills the runaway thread, so both the
 * synchronous and the async runaway cases are bounded
 * (`SCRIPT_SYNC_TIMEOUT_MS` inside the thread, `SCRIPT_ASYNC_TIMEOUT_MS` here).
 *
 * The child thread is started with `env: {}`, so even a full vm escape inside
 * the thread cannot read host secrets, and its only contact with the host is
 * the api RPC below: script-side calls are posted to the parent, executed
 * against the real `ctx.api`, and the result (sanitized into plain,
 * structured-cloneable data) is posted back. Results are sanitized on both
 * sides so no host callable ever reaches script code.
 */
async function runSandboxAction(code: string, ctx: ExecutionContext): Promise<void> {
  if (activeSandboxWorkers >= MAX_SANDBOX_WORKERS) {
    console.warn(
      `[Script ${ctx.botId}] Skipped custom action — ${activeSandboxWorkers} sandbox threads already active (cap: ${MAX_SANDBOX_WORKERS})`,
    );
    return;
  }

  const api = ctx.api as unknown as Record<string, unknown>;
  const methodNames = apiMethodNames(api);

  const worker = new Worker(SANDBOX_WORKER_SOURCE, {
    eval: true,
    env: {},
    // Defense in depth alongside the vm context resourceLimits: the thread's
    // own heap is capped too, so a memory blowup cannot take down the process.
    resourceLimits: { maxOldGenerationSizeMb: 128 },
    workerData: {
      code,
      snapshot: ctxSnapshot(ctx),
      methodNames,
      syncTimeoutMs: SCRIPT_SYNC_TIMEOUT_MS,
    },
  });

  activeSandboxWorkers += 1;
  // Always fired: on natural exit, on terminate() from the timeout/error paths
  // and on abnormal crash — so the counter can never leak a dead thread.
  worker.once('exit', () => {
    activeSandboxWorkers = Math.max(0, activeSandboxWorkers - 1);
  });

  const postResult = (msg: { id: number; ok: boolean; value?: unknown; error?: string }): void => {
    try {
      worker.postMessage({ type: 'result', ...msg });
    } catch {
      // The worker was already terminated; there is nothing left to reply to.
    }
  };

  const handleCall = async (msg: {
    id: number;
    method: string;
    args?: unknown[];
  }): Promise<void> => {
    try {
      const fn = api[msg.method];
      if (typeof fn !== 'function') throw new Error(`Unknown script api method: ${msg.method}`);
      const raw = await (fn as (...args: unknown[]) => unknown)(...(msg.args ?? []));
      postResult({ id: msg.id, ok: true, value: toCloneable(await fetchResponseToPlain(raw)) });
    } catch (err) {
      postResult({
        id: msg.id,
        ok: false,
        error: String(((err as Error)?.message as string) ?? err),
      });
    }
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new Error('Script action timed out (possible infinite loop)'));
      });
    }, SCRIPT_ASYNC_TIMEOUT_MS);

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      fn();
    };

    const onMessage = (msg: {
      type?: string;
      id?: number;
      ok?: boolean;
      error?: string;
      method?: string;
      args?: unknown[];
    }): void => {
      if (msg.type === 'call' && msg.id !== undefined && msg.method) {
        void handleCall({ id: msg.id, method: msg.method, args: msg.args });
        return;
      }
      if (msg.type !== 'done') return;
      finish(() => {
        void worker.terminate();
        if (msg.ok) {
          resolve();
        } else {
          const raw = msg.error ?? 'Script action failed';
          reject(
            raw.includes('Script execution timed out')
              ? new Error('Script action timed out (possible infinite loop)', {
                  cause: new Error(raw),
                })
              : new Error(raw),
          );
        }
      });
    };

    const onError = (err: Error): void => {
      finish(() => reject(err));
    };

    const onExit = (code: number): void => {
      // The thread died before posting `done`. Non-zero exits are usually
      // preceded by an 'error' event; a clean exit without `done` is also an
      // abnormal result for a script action.
      finish(() => {
        reject(
          new Error(
            code === 0
              ? 'Script action exited unexpectedly'
              : `Script worker exited with code ${code}`,
          ),
        );
      });
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}

/**
 * Flattens a fetch-like result (a real `Response` or a test mock with
 * `text()`) into plain data before it crosses the worker boundary. The worker's
 * `safeFetch` wrapper needs the body text as a string so it can rebuild VM-realm
 * `json()`/`text()` functions; functions cannot be structured-cloned directly.
 */
async function fetchResponseToPlain(value: unknown): Promise<unknown> {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { text?: unknown }).text === 'function'
  ) {
    const MAX_RESPONSE_BODY_BYTES = 1_048_576; // 1 MB
    const res = value as {
      ok?: unknown;
      status?: unknown;
      statusText?: unknown;
      headers?: {
        forEach?: (cb: (v: string, k: string) => void) => void;
        entries?: () => Iterable<[string, string]>;
      };
      text?: () => Promise<string>;
    };
    let text = '';
    try {
      const raw = (await res.text?.()) ?? '';
      text = raw.length > MAX_RESPONSE_BODY_BYTES ? raw.slice(0, MAX_RESPONSE_BODY_BYTES) : raw;
    } catch {
      // Keep the default '' when the body cannot be read.
    }
    const headers: Record<string, string> = {};
    try {
      if (typeof res.headers?.forEach === 'function') {
        res.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (typeof res.headers?.entries === 'function') {
        for (const [k, v] of res.headers.entries()) headers[k] = v;
      }
    } catch {
      // Header extraction is best-effort; a malformed response still gets ok/status.
    }
    return {
      ok: res.ok ?? false,
      status: res.status ?? 0,
      statusText: res.statusText ?? '',
      headers,
      text,
    };
  }
  return value;
}

/**
 * Recursively converts a value into plain, structured-cloneable data so it can
 * cross the worker boundary. Functions/symbols are dropped and Maps/Sets/Dates
 * are flattened; `postMessage` would otherwise throw on them.
 */
function toCloneable(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return value;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined')
    return undefined;
  if (Array.isArray(value)) return value.map(toCloneable);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) out[String(k)] = toCloneable(v);
    return out;
  }
  if (value instanceof Set) return [...value].map(toCloneable);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toCloneable(v);
    return out;
  }
  return undefined;
}

function interpolate(template: string, ctx: ExecutionContext): string {
  return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (_, path) => {
    let value: unknown;
    if (path.startsWith('counters.')) {
      value = ctx.counters.get(path.slice('counters.'.length));
    } else if (path.startsWith('variables.')) {
      value = ctx.variables.get(path.slice('variables.'.length));
    } else {
      value = resolvePath(ctx.event, path) ?? ctx.variables.get(path) ?? ctx.counters.get(path);
    }
    return String(value ?? '');
  });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === 'object') {
      if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj as unknown);
}
