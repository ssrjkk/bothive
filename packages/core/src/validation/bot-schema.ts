import { z } from 'zod';
import { isRegexSafe } from './script-config.js';
import { isWebhookUrlAllowed } from '../webhooks/index.js';

export const PlatformSchema = z.enum(['telegram', 'twitch', 'youtube', 'twitter', 'crypto']);

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

export const BotConfigSchema = z.object({
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
          privateKey: z.string().min(1),
        })
        .optional(),
    })
    .optional(),
});

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
