import { z } from 'zod';
import { isRegexSafe } from './script-config.js';
import { isWebhookUrlAllowed } from '../webhooks/index.js';

export const PlatformSchema = z.enum([
  'telegram',
  'twitch',
  'youtube',
  'twitter',
  'crypto',
  'discord',
  'slack',
  'bluesky',
]);

function isValidTime(value: string): boolean {
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export const BotCredentialsSchema = z.object({
  token: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  accessToken: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  apiKeys: z
    .array(z.object({ apiKey: z.string().min(1), apiSecret: z.string().min(1) }))
    .optional(),
  username: z.string().optional(),
  channel: z.string().optional(),
  channelId: z.string().optional(),
});

export const RateLimitBudgetSchema = z.object({
  maxRequests: z.number().int().min(1).max(1_000_000),
  windowMs: z.number().int().min(100).max(86_400_000),
});

/** Per-action-type rate limit budgets (see @bothive/core rate-limit/budget). */
export const RateLimitBudgetsSchema = z.object({
  default: RateLimitBudgetSchema,
  overrides: z.record(z.string(), RateLimitBudgetSchema).optional(),
});

const ActiveWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
});

const LifecycleScheduleSchema = z.object({
  // JSON object keys are strings; the core reads them as day-of-week numbers,
  // and JS property access coerces "0".."6" back to numbers automatically.
  activeWindows: z.record(z.string(), z.array(ActiveWindowSchema)).optional(),
  timezone: z.string().max(64).optional(),
  jitterMs: z.number().int().min(0).max(3_600_000).optional(),
});

const HumanDelayConfigSchema = z.object({
  messageGap: z.boolean().optional(),
  thinkingPause: z.boolean().optional(),
  reactionDelay: z.boolean().optional(),
  scale: z.number().min(0).max(100).optional(),
});

const HumanBehaviorSchema = z.object({
  enabled: z.boolean(),
  schedule: LifecycleScheduleSchema.optional(),
  timezone: z.string().max(64).optional(),
  humanDelay: z.union([z.boolean(), HumanDelayConfigSchema]).optional(),
});

const WarmingConfigSchema = z.object({
  durationDays: z.number().int().min(1).max(365),
  maxDailyActions: z.number().int().min(0).max(100_000),
  maxDailyPosts: z.number().int().min(0).max(100_000),
  firstPostDay: z.number().int().min(1).max(365),
});

export const BotConfigSchema = z
  .object({
    pollingInterval: z.number().int().min(1000).max(3600000).optional(),
    dailyLimit: z.number().int().min(0).optional(),
    workHours: z
      .object({
        start: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM'),
        end: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM'),
      })
      .refine((w) => isValidTime(w.start) && isValidTime(w.end), { message: 'invalid time range' })
      .optional(),
    webhookUrl: z
      .string()
      .url()
      .refine((u) => {
        try {
          const proto = new URL(u).protocol;
          return (proto === 'http:' || proto === 'https:') && isWebhookUrlAllowed(u);
        } catch {
          return false;
        }
      }, 'must be a public http(s) URL')
      .optional(),
    rateLimitPerMinute: z.number().int().min(1).max(1000).optional(),
    // Per-action-type budgets: each action type gets its own window/cap, so a
    // burst in one endpoint never starves another (see rate-limit/budget.ts).
    rateLimitBudgets: RateLimitBudgetsSchema.optional(),
    // Human-like behavior (sleep/wake schedule + optional send delays) and
    // account warming (gradual action ramp-up for new bots). Both are read by
    // the workers from bot.config; these schemas keep them from being stripped
    // by zod's default object-strip on create/update.
    behavior: HumanBehaviorSchema.optional(),
    warming: WarmingConfigSchema.optional(),
    // Platform routing: the Twitch worker joins the channel from config, and
    // YouTube/Twitter read username/channel from the same place. Without these
    // keys the API silently stripped them on every create/update.
    channelId: z.string().max(200).optional(),
    channel: z.string().max(200).optional(),
    username: z.string().max(200).optional(),
    // Local AI auto-reply (Ollama): the workers read these from config. They
    // were previously stripped by the schema, making the AI toggle dead via the
    // API (and wiping it whenever any other config field was edited).
    aiEnabled: z.boolean().optional(),
    aiModel: z.string().max(200).optional(),
    aiSystemPrompt: z.string().max(4000).optional(),
    // Telegram bots only: receive updates via a Telegram webhook (the worker
    // registers it on connect) instead of long polling. Requires the workers to
    // run with TELEGRAM_WEBHOOK_BASE_URL set to the public API base URL.
    telegramWebhook: z.boolean().optional(),
    crypto: z
      .object({
        symbols: z
          .array(
            z
              .string()
              .min(1)
              .max(24)
              .regex(/^[A-Z0-9]{2,20}$/),
          )
          .min(1)
          .max(50)
          .optional(),
        coinIds: z
          .array(
            z
              .string()
              .min(1)
              .max(64)
              .regex(/^[a-z0-9-]{1,64}$/),
          )
          .min(1)
          .max(50)
          .optional(),
        source: z.enum(['binance', 'coingecko', 'auto']).optional(),
        pollInterval: z.number().int().min(5000).max(3600000).optional(),
        strategy: z.enum(['sma', 'rsi', 'alert']).optional(),
        strategyParams: z.record(z.string(), z.unknown()).optional(),
        tradeMode: z.enum(['dry', 'live']).optional(),
        maxOrderValueUsdt: z.number().positive().max(1_000_000).optional(),
        maxDailyOrderValueUsdt: z.number().min(0).max(100_000_000).optional(),
        allowedSymbols: z
          .array(
            z
              .string()
              .min(2)
              .max(20)
              .regex(/^[A-Za-z0-9]{2,20}$/),
          )
          .max(50)
          .optional(),
        wallet: z
          .object({
            address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a valid EVM address'),
            // Optional because the API never returns it: clients saving a config
            // they fetched see only the address, and the update handler preserves
            // the stored key when one is missing here.
            privateKey: z.string().min(1).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  // Unknown keys are PRESERVED, not stripped: the schema validates everything
  // it knows about, and any other key survives create/update intact. Stripping
  // was a silent data-loss footgun — a bot whose config carried a key the
  // schema had never heard of (e.g. an adapter-specific setting) lost it the
  // moment any other config field was edited through the API.
  .passthrough();

export const CreateBotSchema = z.object({
  name: z.string().min(1).max(100),
  platform: PlatformSchema,
  accountId: z.string().min(1),
  config: BotConfigSchema.optional(),
});

export const UpdateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: BotConfigSchema.optional(),
});

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(100),
});

export const ScriptTriggerSchema = z.enum([
  'message',
  'follow',
  'subscribe',
  'donation',
  'comment',
  'interval',
  'raid',
  'host',
  'price',
  'signal',
  'trade',
]);

export const CreateScriptSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1).max(100),
  trigger: ScriptTriggerSchema,
  config: z.object({
    filters: z
      .array(
        z.discriminatedUnion('type', [
          // Only `regex` filters are regexes: `keyword`/`role`/`custom` values
          // are plain text (a keyword like `C++` must not be rejected as an
          // invalid or "unsafe" regex).
          z.object({
            type: z.literal('regex'),
            value: z.string().max(500).refine(isRegexSafe, { message: 'unsafe or invalid regex' }),
            field: z.string().max(200).optional(),
          }),
          z.object({
            type: z.literal('keyword'),
            value: z.string().max(500),
            field: z.string().max(200).optional(),
          }),
          z.object({
            type: z.literal('role'),
            value: z.string().max(500),
            field: z.string().max(200).optional(),
          }),
          z.object({
            type: z.literal('custom'),
            value: z.string().max(500),
            field: z.string().max(200).optional(),
          }),
        ]),
      )
      .optional(),
    actions: z.array(
      z.object({
        type: z.string().max(50),
        payload: z.record(z.string(), z.unknown()).optional(),
        condition: z.unknown().optional(),
        actions: z.array(z.unknown()).optional(),
      }),
    ),
    variables: z.record(z.string(), z.unknown()).optional(),
    cooldown: z.number().int().min(0).max(86_400).optional(),
    interval: z.number().int().min(1).max(86_400).optional(),
    maxExecutionMs: z.number().int().min(100).max(600_000).optional(),
  }),
  enabled: z.boolean().optional(),
});

export const CreateAccountSchema = z.object({
  name: z.string().min(1).max(100),
  platform: PlatformSchema,
  credentials: BotCredentialsSchema.optional(),
});
