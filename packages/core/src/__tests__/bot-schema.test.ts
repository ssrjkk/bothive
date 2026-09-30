import { describe, it, expect } from 'vitest';
import { CreateBotSchema, UpdateBotSchema, BotConfigSchema } from '../validation/bot-schema.js';

const BASE_BOT = { name: 'Bot', platform: 'twitch', accountId: 'a1' };

describe('BotConfigSchema keeps resilience/behavior keys', () => {
  it('keeps rateLimitPerMinute and rateLimitBudgets in the parsed config', () => {
    const parsed = CreateBotSchema.safeParse({
      ...BASE_BOT,
      config: {
        rateLimitPerMinute: 5,
        rateLimitBudgets: {
          default: { maxRequests: 30, windowMs: 60_000 },
          overrides: { tweet: { maxRequests: 17, windowMs: 900_000 } },
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.config).toMatchObject({
      rateLimitPerMinute: 5,
      rateLimitBudgets: {
        default: { maxRequests: 30, windowMs: 60_000 },
        overrides: { tweet: { maxRequests: 17, windowMs: 900_000 } },
      },
    });
  });

  it('keeps behavior (schedule + humanDelay) in the parsed config', () => {
    const parsed = CreateBotSchema.safeParse({
      ...BASE_BOT,
      config: {
        behavior: {
          enabled: true,
          schedule: {
            activeWindows: { 1: [{ startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 }] },
            timezone: 'Europe/Moscow',
          },
          humanDelay: { messageGap: false, scale: 2 },
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.config?.behavior).toMatchObject({
      enabled: true,
      schedule: { timezone: 'Europe/Moscow' },
      humanDelay: { messageGap: false, scale: 2 },
    });
  });

  it('keeps warming in the parsed config', () => {
    const parsed = CreateBotSchema.safeParse({
      ...BASE_BOT,
      config: {
        warming: { durationDays: 7, maxDailyActions: 10, maxDailyPosts: 3, firstPostDay: 2 },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.config?.warming).toEqual({
      durationDays: 7,
      maxDailyActions: 10,
      maxDailyPosts: 3,
      firstPostDay: 2,
    });
  });

  it('preserves unknown config keys instead of stripping them', () => {
    const parsed = CreateBotSchema.safeParse({
      ...BASE_BOT,
      config: { rateLimitPerMinute: 3, sneaky: 'kept' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.config).toEqual({ rateLimitPerMinute: 3, sneaky: 'kept' });
  });

  it('keeps aiEnabled/aiModel/aiSystemPrompt and channel routing keys', () => {
    const parsed = CreateBotSchema.safeParse({
      ...BASE_BOT,
      config: {
        aiEnabled: true,
        aiModel: 'qwen2.5:7b',
        aiSystemPrompt: 'Be helpful',
        channelId: '123456',
        channel: 'mychannel',
        username: 'botuser',
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.config).toMatchObject({
      aiEnabled: true,
      aiModel: 'qwen2.5:7b',
      aiSystemPrompt: 'Be helpful',
      channelId: '123456',
      channel: 'mychannel',
      username: 'botuser',
    });
  });

  it('rejects malformed budgets', () => {
    const parsed = CreateBotSchema.safeParse({
      ...BASE_BOT,
      config: { rateLimitBudgets: { default: { maxRequests: -1, windowMs: 1000 } } },
    });
    expect(parsed.success).toBe(false);
  });

  it('UpdateBotSchema round-trips a full config untouched', () => {
    const config = {
      rateLimitPerMinute: 4,
      rateLimitBudgets: { default: { maxRequests: 10, windowMs: 30_000 } },
      behavior: { enabled: true },
      warming: { durationDays: 5, maxDailyActions: 5, maxDailyPosts: 2, firstPostDay: 3 },
    };
    const parsed = UpdateBotSchema.safeParse({ config });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.config).toEqual(config);
  });

  it('BotConfigSchema itself accepts the budgets shape', () => {
    expect(
      BotConfigSchema.safeParse({
        rateLimitBudgets: { default: { maxRequests: 30, windowMs: 60_000 } },
      }).success,
    ).toBe(true);
  });
});
