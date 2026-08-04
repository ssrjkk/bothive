import type { Platform } from './bot.js';

export type EventType =
  | 'message'
  | 'follow'
  | 'subscribe'
  | 'donation'
  | 'comment'
  | 'raid'
  | 'host'
  | 'error';

export interface PlatformEvent {
  botId: string;
  platform: Platform;
  type: EventType;
  payload: Record<string, unknown>;
  timestamp: Date;
  raw?: unknown;
}

export interface EventHandler {
  (event: PlatformEvent): Promise<void>;
}
