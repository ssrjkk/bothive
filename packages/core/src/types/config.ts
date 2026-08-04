export interface WorkerConfig {
  platform: string;
  concurrency: number;
  maxBotsPerWorker: number;
  redisUrl: string;
  queueName: string;
}

export interface QueueJob<T = unknown> {
  id: string;
  type: 'connect' | 'disconnect' | 'reconnect' | 'execute' | 'update';
  botId: string;
  data: T;
  priority?: number;
  delay?: number;
}

export interface ApiConfig {
  port: number;
  host: string;
  jwtSecret: string;
  databaseUrl: string;
  redisUrl: string;
  encryptionKey: string;
}
