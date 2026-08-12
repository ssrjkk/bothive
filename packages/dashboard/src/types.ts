// Shared API response shapes used across pages.

export interface LogEntry {
  id: string;
  botId: string;
  level: string;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface BotRef {
  id: string;
  name: string;
}

export interface QueueMetrics {
  platform: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}
