import vm from 'node:vm';
import { isWebhookUrlAllowed } from '@bothive/core';

const MAX_DELAY_MS = 300_000;
const MAX_CUSTOM_CODE = 4000;
const SCRIPT_SYNC_TIMEOUT_MS = 1000;
const SCRIPT_ASYNC_TIMEOUT_MS = 5000;
const FORBIDDEN_CODE_PATTERNS = [
  /\bprocess\b/,
  /\brequire\s*\(/,
  /\bmodule\b/,
  /\bexports\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\bFunction\b/,
  /\beval\s*\(/,
  /\bconstructor\b/,
  /__proto__/,
  /\bprototype\b/,
  /\bimport\b/,
];

interface ScriptStep {
  type: 'reply' | 'react' | 'forward' | 'custom' | 'increment_counter' | 'if' | 'log' | 'delay' | 'webhook' | 'random_reply' | 'say';
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
  trigger: string;
  filters?: ScriptFilter[];
  actions: ScriptStep[];
  variables?: Record<string, unknown>;
  /** Minimum seconds between firings (anti-spam / anti-loop). 0 or undefined = no limit. */
  cooldown?: number;
  /** Run this script periodically (seconds). Used with a synthetic 'interval' event. */
  interval?: number;
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
}

export interface ScriptApi {
  sendMessage: (chatId: string | number, text: string, opts?: Record<string, unknown>) => Promise<unknown>;
  sendPhoto: (chatId: string | number, photo: string, caption?: string) => Promise<unknown>;
  deleteMessage: (chatId: string | number, messageId: number) => Promise<unknown>;
  say: (channel: string, message: string) => Promise<unknown>;
  timeout: (channel: string, user: string, seconds: number, reason?: string) => Promise<unknown>;
  tweet: (text: string) => Promise<unknown>;
  reply: (text: string, tweetId: string) => Promise<unknown>;
  react: (payload: Record<string, unknown>) => Promise<unknown>;
  log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  remember?: <T>(key: string, value: T, ttl?: number) => Promise<unknown>;
  recall?: <T>(key: string) => Promise<T | undefined>;
  forget?: (key: string) => Promise<unknown>;
}

export class ScriptEngine {
  private scripts: Map<string, ScriptConfig> = new Map();
  private counters: Map<string, Map<string, number>> = new Map();
  private cooldowns: Map<string, number> = new Map();

  register(botId: string, config: ScriptConfig): void {
    const key = `${botId}:${config.trigger}`;
    this.scripts.set(key, config);

    if (!this.counters.has(botId)) {
      this.counters.set(botId, new Map());
    }
  }

  unregister(botId: string): void {
    for (const [key] of this.scripts) {
      if (key.startsWith(botId)) this.scripts.delete(key);
    }
    this.counters.delete(botId);
    this.cooldowns.delete(botId);
  }

  clear(): void {
    this.scripts.clear();
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

  async execute(botId: string, event: Record<string, unknown>, api: ScriptApi): Promise<void> {
    const eventType = event.type as string;

    for (const [key, script] of this.scripts) {
      if (!key.startsWith(`${botId}:${eventType}`)) continue;
      await this.runScript(script, botId, event, api);
    }
  }

  /** Run a single script config once, bypassing cooldown (used for manual tests). */
  async executeOnce(script: ScriptConfig, botId: string, event: Record<string, unknown>, api: ScriptApi): Promise<void> {
    await this.runScript(script, botId, event, api, true);
  }

  private async runScript(script: ScriptConfig, botId: string, event: Record<string, unknown>, api: ScriptApi, ignoreCooldown = false): Promise<void> {
    const key = `${botId}:${script.trigger}`;

    if (!ignoreCooldown && script.cooldown && script.cooldown > 0) {
      const lastFired = this.cooldowns.get(key) ?? 0;
      if (Date.now() - lastFired < script.cooldown * 1000) return;
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

    try {
      if (!this.matchesFilters(script.filters ?? [], ctx)) return;

      await this.runActions(script.actions, ctx);
    } finally {
      // Set the cooldown even on failure so a broken script does not re-fire on
      // every matching event (repeated failed platform calls / log spam).
      if (!ignoreCooldown && script.cooldown && script.cooldown > 0) {
        this.cooldowns.set(key, Date.now());
      }
    }
  }

  private matchesFilters(filters: ScriptFilter[], ctx: ExecutionContext): boolean {
    if (filters.length === 0) return true;

    const text = (ctx.event.text ?? ctx.event.message ?? '') as string;

    return filters.every((filter) => {
      switch (filter.type) {
        case 'role': {
          const target = filter.field
            ? (resolvePath(ctx.event, filter.field) as string ?? '')
            : (ctx.event.role as string ?? '');
          return String(target).toLowerCase() === String(filter.value).toLowerCase();
        }
        case 'regex': {
          const target = filter.field ? (resolvePath(ctx.event, filter.field) as string ?? '') : text;
          if (filter.value.length > 500) return false;
          try {
            return new RegExp(filter.value, 'i').test(target);
          } catch {
            return false;
          }
        }
        case 'keyword': {
          const target = filter.field ? (resolvePath(ctx.event, filter.field) as string ?? '') : text;
          return target.toLowerCase().includes(filter.value.toLowerCase());
        }
        case 'custom':
          if (!isCodeAllowed(filter.value)) return false;
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
            await ctx.api.log('info', step.payload?.message as string ?? 'Script log', step.payload as Record<string, unknown>);
            break;
          case 'delay':
            await new Promise((r) => setTimeout(r, Math.min((step.payload?.ms as number) ?? 1000, MAX_DELAY_MS)));
            break;
          case 'webhook':
            if (step.payload?.url) {
              const url = step.payload.url as string;
              if (isWebhookUrlAllowed(url)) {
                await ctx.api.fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...step.payload, ctx: webhookCtxSnapshot(ctx) }),
                });
              } else {
                console.warn(`[Script ${ctx.botId}] Blocked webhook action to disallowed URL: ${url}`);
              }
            }
            break;
          case 'custom':
            if (isCodeAllowed(step.payload?.code as string ?? '')) {
              try {
                await runSandboxAction(step.payload?.code as string ?? '', ctx);
              } catch (err) {
                console.error(`[Script] Custom action error:`, err);
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
      }
    }
  }

  private async handleReply(step: ScriptStep, ctx: ExecutionContext): Promise<void> {
    const text = interpolate(step.payload?.text as string ?? '', ctx);
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
      if (left === undefined) left = ctx.variables.get(condition.field) as string | number | undefined;
      if (left === undefined) left = ctx.counters.get(condition.field) as string | number | undefined;
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
      case 'regex':
        try {
          return new RegExp(String(condition.value), 'i').test(String(left));
        } catch {
          return false;
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
 * Builds the VM context for custom script code.
 *
 * The script sees:
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
 *
 * vm + a regex blacklist is still not a hard boundary against a fully hostile
 * author (async code running after an `await` cannot be pre-empted in-process);
 * scripts remain trusted operator-authored code, but the host-realm Function
 * leak — which gave arbitrary `process.env` / I/O access — is eliminated.
 */
function runSandboxContext(ctx: ExecutionContext): vm.Context {
  const api = ctx.api as unknown as Record<string, unknown>;
  const methodNames = Object.keys(api).filter((key) => typeof api[key] === 'function');

  const sandbox: Record<string, unknown> = Object.assign(Object.create(null), {
    ctx: ctxSnapshot(ctx),
  });
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

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

  return context;
}

function isCodeAllowed(code: string): boolean {
  if (code.length > MAX_CUSTOM_CODE) return false;
  for (const pattern of FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(code)) return false;
  }
  return true;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Script execution timed out');
}

function raceWithTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Script exceeded ${ms}ms execution limit`)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function runSandboxExpression(expression: string, ctx: ExecutionContext): unknown {
  const context = runSandboxContext(ctx);
  return vm.runInContext(`(${expression})`, context, { timeout: SCRIPT_SYNC_TIMEOUT_MS });
}

async function runSandboxAction(code: string, ctx: ExecutionContext): Promise<void> {
  const context = runSandboxContext(ctx);
  let result: unknown;
  try {
    vm.runInContext(`this.__run = async (ctx) => {\n${code}\n}`, context, { timeout: SCRIPT_SYNC_TIMEOUT_MS });
    // Invoking under a vm timeout bounds the synchronous portion of the async body,
    // so a `while(true){}` at the start cannot freeze the whole worker process.
    result = vm.runInContext(`__run(ctx)`, context, { timeout: SCRIPT_SYNC_TIMEOUT_MS });
  } catch (err) {
    if (isTimeoutError(err)) throw new Error('Script action timed out (possible infinite loop)');
    throw err;
  }
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    await raceWithTimeout(result as PromiseLike<unknown>, SCRIPT_ASYNC_TIMEOUT_MS);
  }
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
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj as unknown);
}
