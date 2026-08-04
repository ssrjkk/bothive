export type Platform = 'telegram' | 'twitch' | 'youtube' | 'twitter';

export type BotStatus = 'idle' | 'running' | 'paused' | 'error' | 'connecting';

export interface BotConfig {
  id: string;
  name: string;
  platform: Platform;
  credentials: BotCredentials;
  settings: BotSettings;
  status: BotStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface BotCredentials {
  token?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  apiKey?: string;
}

export interface BotSettings {
  webhookUrl?: string;
  pollingInterval?: number;
  dailyLimit?: number;
  workHours?: { start: string; end: string };
  filters?: BotFilter[];
}

export interface BotFilter {
  type: 'regex' | 'keyword' | 'role' | 'custom';
  value: string;
}

export interface BotAction {
  type: 'reply' | 'react' | 'forward' | 'custom';
  payload: Record<string, unknown>;
}
