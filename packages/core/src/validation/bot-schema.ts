import { z } from 'zod';
import { isRegexSafe } from './script-config.js';
import { isWebhookUrlAllowed } from '../webhooks/index.js';

export const PlatformSchema = z.enum(['telegram', 'twitch', 'youtube', 'twitter']);

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
  username: z.string().optional(),
  channel: z.string().optional(),
  channelId: z.string().optional(),
});

export const BotConfigSchema = z.object({
  pollingInterval: z.number().int().min(1000).max(3600000).optional(),
  dailyLimit: z.number().int().min(0).optional(),
  workHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM'),
    end: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM'),
  }).refine((w) => isValidTime(w.start) && isValidTime(w.end), { message: 'invalid time range' }).optional(),
  webhookUrl: z.string().url().refine((u) => {
    try {
      const proto = new URL(u).protocol;
      return (proto === 'http:' || proto === 'https:') && isWebhookUrlAllowed(u);
    } catch {
      return false;
    }
  }, 'must be a public http(s) URL').optional(),
  rateLimitPerMinute: z.number().int().min(1).max(1000).optional(),
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

export const ScriptTriggerSchema = z.enum(['message', 'follow', 'subscribe', 'donation', 'comment', 'interval', 'status']);

export const CreateScriptSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1).max(100),
  trigger: ScriptTriggerSchema,
  config: z.object({
    filters: z.array(z.object({
      type: z.enum(['regex', 'keyword', 'role', 'custom']),
      value: z.string().max(500).refine(isRegexSafe, { message: 'unsafe or invalid regex' }),
      field: z.string().max(200).optional(),
    })).optional(),
    actions: z.array(z.object({
      type: z.string().max(50),
      payload: z.record(z.string(), z.unknown()).optional(),
      condition: z.unknown().optional(),
      actions: z.array(z.unknown()).optional(),
    })),
    variables: z.record(z.string(), z.unknown()).optional(),
  }),
  enabled: z.boolean().optional(),
});

export const CreateAccountSchema = z.object({
  name: z.string().min(1).max(100),
  platform: PlatformSchema,
  credentials: BotCredentialsSchema.optional(),
});
