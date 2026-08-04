import type { BotCredentials, BotAction } from '../types/bot.js';
import type { EventHandler } from '../types/events.js';

export interface IBotPlatform {
  readonly platformName: string;

  connect(credentials: BotCredentials): Promise<void>;
  disconnect(botId: string): Promise<void>;
  onEvent(handler: EventHandler): void;
  executeAction(botId: string, action: BotAction): Promise<unknown>;
  getStatus(botId: string): string;
  isConnected(botId: string): boolean;
}
