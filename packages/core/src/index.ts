export type { Platform as PlatformType, BotStatus, BotAction } from './types/bot.js';
export type { EventType, PlatformEvent, EventHandler } from './types/events.js';
export type { WorkerConfig, QueueJob, ApiConfig } from './types/config.js';
export type { IBotPlatform } from './interfaces/IBotPlatform.js';
export { encrypt, decrypt, generateEncryptionKey } from './utils/crypto.js';
export {
  encryptCredential,
  decryptCredential,
  ensureEncrypted,
} from './utils/credential-cipher.js';
export { RateLimiter } from './utils/rate-limiter.js';
export { RedisRateLimiter } from './utils/redis-rate-limiter.js';
export type { RateLimitClient } from './utils/redis-rate-limiter.js';
export { isStrongSecret, validateApiSecrets, validateWorkerSecrets } from './utils/secrets.js';
export {
  initSentry,
  isSentryEnabled,
  captureError,
  type SentryInitOptions,
} from './utils/sentry.js';
export { redisConnectionOptions, redisCommandOptions } from './utils/redis.js';
export { parseWorkerHeartbeat, type WorkerHeartbeat } from './utils/heartbeat.js';
export {
  initTracing,
  isTracingEnabled,
  shutdownTracing,
  type TracingOptions,
} from './utils/tracing.js';
export { stripControlChars } from './utils/sanitize.js';
export * from './errors/index.js';
export * from './events/index.js';
export * from './domain/index.js';
export * from './state-machine/index.js';
export * from './memory/index.js';
export * from './validation/index.js';
export * from './cqrs/index.js';
export * from './resilience/index.js';
export { patterns, getPattern, listPatterns } from './patterns/library.js';
export type {
  PatternDefinition,
  PatternParamSpec,
  GeneratedScriptConfig,
} from './patterns/library.js';
export * from './crypto/index.js';
export {
  WEBHOOK_EVENT_TYPES,
  signPayload,
  deliverWebhook,
  fetchWithGuard,
  isWebhookUrlAllowed,
  assertWebhookUrlAllowed,
  isPrivateIp,
  telegramWebhookSlug,
} from './webhooks/index.js';
export type { WebhookEventType } from './webhooks/index.js';
export { ProxyPool } from './proxy/proxy-pool.js';
export {
  parseProxyUrl,
  isValidProxyUrl,
  maskProxyUrl,
  testProxy,
} from './proxy/proxy-validator.js';
export type { ProxyInstance, ProxyType } from './proxy/types.js';
export { StickySessionManager, DEFAULT_STICKY_CONFIG } from './proxy/sticky-sessions.js';
export type { StickyConfig, StickyBinding } from './proxy/sticky-sessions.js';
export { validateProxy } from './proxy/proxy-health.js';
export type { ProxyHealthReport } from './proxy/proxy-health.js';
export { getQuotaLimits, checkQuota } from './tenancy/quota.js';
export type { QuotaLimits, QuotaUsage, QuotaResource } from './tenancy/quota.js';
export {
  gaussian,
  logNormal,
  uniform,
  typingDelay,
  messageGap,
  clickDelay,
  reactionDelay,
  thinkingPause,
  scrollDelay,
} from './behavior/human-delay.js';
export type { DelayOptions } from './behavior/human-delay.js';
export {
  shouldBeActive,
  nextTransition,
  HUMAN_DEFAULT_SCHEDULE,
} from './behavior/session-lifecycle.js';
export type {
  ActiveWindow,
  DayOfWeek,
  LifecycleSchedule,
  HumanBehaviorConfig,
} from './behavior/session-lifecycle.js';
export {
  detectAnomaly,
  planRotation,
  warmingLimits,
  DEFAULT_WARMING_CONFIG,
} from './behavior/self-healing.js';
export type {
  HealthSnapshot,
  DetectionResult,
  WarmingConfig,
  WarmingState,
  RotationAction,
} from './behavior/self-healing.js';
export {
  generateResponse,
  checkOllamaHealth,
  preloadModel,
  DEFAULT_OLLAMA_CONFIG,
} from './ai/ollama-client.js';
export type {
  OllamaConfig,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
} from './ai/ollama-client.js';
export {
  transcribeAudio,
  checkWhisperHealth,
  DEFAULT_WHISPER_CONFIG,
} from './ai/whisper-client.js';
export type { WhisperConfig, TranscriptionResult } from './ai/whisper-client.js';
