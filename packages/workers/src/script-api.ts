/**
 * Public types for BotHive script authors.
 *
 * Scripts run inside a hardened Node `vm` sandbox and see exactly two globals:
 *
 *   - `ctx` — a read-only snapshot of the current run (bot, event, variables,
 *     counters) plus the `api` bridge.
 *   - `api` — the platform actions available to the script. Only the methods
 *     the platform adapter implements are callable; invoking a missing action
 *     fails the script safely.
 *
 * Generated editor declarations live in docs/script-api.d.ts (regenerate with
 * `npm run script:types` — this file is the source of truth).
 */

/** Read-only run snapshot exposed to scripts as the `ctx` global. */
export interface ScriptContext {
  /** Bot the script is attached to. */
  botId: string;
  /** Platform the event arrived on (telegram | twitch | youtube | twitter). */
  platform: string;
  /** The triggering event (message, follow, donation, interval, …). */
  event: Record<string, unknown>;
  /** Script variables (JSON config, same for every run of this script). */
  variables: Record<string, unknown>;
  /** Per-bot counters (incremented via the `increment_counter` action). */
  counters: Record<string, unknown>;
  /** Same object as the `api` global. */
  api: ScriptApi;
}

/** Shape of the `api.fetch()` response inside the sandbox. */
export interface ScriptFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Parses the response body as JSON. */
  json(): Promise<unknown>;
  /** Returns the response body as text. */
  text(): Promise<string>;
}

/** Actions exposed to scripts through the `api` global. */
export interface ScriptApi {
  /** Send a chat message (telegram). */
  sendMessage(
    chatId: string | number,
    text: string,
    opts?: Record<string, unknown>,
  ): Promise<unknown>;
  /** Send a photo by URL (telegram). */
  sendPhoto(chatId: string | number, photo: string, caption?: string): Promise<unknown>;
  /** Delete a message (telegram). */
  deleteMessage(chatId: string | number, messageId: number): Promise<unknown>;
  /** Send an IRC message (twitch). */
  say(channel: string, message: string): Promise<unknown>;
  /** Timeout a viewer (twitch). */
  timeout(channel: string, user: string, seconds: number, reason?: string): Promise<unknown>;
  /** Post a tweet (twitter). */
  tweet(text: string): Promise<unknown>;
  /** Reply to the triggering event (twitter). */
  reply(text: string, tweetId: string): Promise<unknown>;
  /** React to a message / tweet (telegram, twitter). */
  react(payload: Record<string, unknown>): Promise<unknown>;
  /** Current price of a symbol (crypto bots). */
  getPrice?(symbol: string): Promise<unknown>;
  /** OHLC candles for a symbol (crypto bots). */
  getCandles?(symbol: string, interval?: string, limit?: number): Promise<unknown>;
  /** Wallet balance for an asset (crypto bots). */
  getBalance?(asset: string): Promise<unknown>;
  /** Market buy (crypto bots). */
  marketBuy?(symbol: string, amountUsdt: number): Promise<unknown>;
  /** Market sell (crypto bots). */
  marketSell?(symbol: string, quantity: number): Promise<unknown>;
  /** Full wallet snapshot (crypto bots). */
  getWallet?(): Promise<unknown>;
  /** Write to the bot's log stream. */
  log(level: string, message: string, meta?: Record<string, unknown>): Promise<void>;
  /**
   * SSRF-guarded HTTP fetch — every redirect hop is re-validated against the
   * private/loopback blocklist before it is followed.
   */
  fetch(url: string, opts?: RequestInit): Promise<ScriptFetchResponse>;
  /** Store a value in the bot's Redis-backed memory. */
  remember?<T>(key: string, value: T, ttl?: number): Promise<unknown>;
  /** Read a value from memory. */
  recall?<T>(key: string): Promise<T | undefined>;
  /** Remove a value from memory. */
  forget?(key: string): Promise<unknown>;
}

declare global {
  const api: ScriptApi;
  const ctx: ScriptContext;
}
