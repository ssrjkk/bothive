export type Platform = 'telegram' | 'twitch' | 'youtube' | 'twitter' | 'crypto';

export type BotStatus = 'idle' | 'running' | 'paused' | 'error' | 'connecting';

/**
 * Platform credential fields. Mirrors `BotCredentials` in `domain/bot.ts` and
 * the `BotCredentialsSchema` in `validation/bot-schema.ts`; keep all three in
 * sync. `username`/`channel`/`channelId` are used by the Twitch worker and by
 * bot config for YouTube/Twitter.
 */
export interface BotCredentials {
  token?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  apiKey?: string;
  apiSecret?: string;
  username?: string;
  channel?: string;
  channelId?: string;
}

export interface BotAction {
  type: 'reply' | 'react' | 'forward' | 'custom';
  payload: Record<string, unknown>;
}
