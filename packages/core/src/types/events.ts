import type { Platform } from './bot.js';

export type EventType =
  | 'message'
  | 'follow'
  | 'subscribe'
  | 'donation'
  | 'comment'
  | 'raid'
  | 'host'
  | 'price'
  | 'signal'
  | 'trade'
  | 'interval'
  | 'error'
  | 'reaction'
  | 'member_join'
  | 'team_join'
  | 'like'
  | 'repost'
  | 'mention'
  | 'quote'
  | 'reply'
  | 'notification';

export interface PlatformEvent {
  botId: string;
  platform: Platform;
  type: EventType;
  payload: Record<string, unknown>;
  timestamp: Date;
  /**
   * Contract version of this event's payload shape (see contracts registry).
   * Stamped by the worker before emission so consumers and the event store can
   * interpret the payload correctly, including years later during replay.
   */
  v: number;
  /**
   * Idempotency key. Derived deterministically from the platform's natural
   * event id (message id, update id, ...) when one exists, so a replayed or
   * redelivered event is recognized as a duplicate; a random UUID otherwise.
   */
  eventId: string;
  /**
   * Set when the event was re-emitted by the replay API rather than produced
   * live by the platform. Replays re-run scripts and webhooks but skip
   * side effects that must not repeat (e.g. an AI auto-reply to the chat).
   */
  replayed?: boolean;
  raw?: unknown;
}

export interface EventHandler {
  (event: PlatformEvent): Promise<void>;
}

/**
 * An event as produced by a platform adapter: `v` and `eventId` are stamped by
 * the worker's emit funnel before anything downstream sees it.
 */
export type PlatformEventInput = Omit<PlatformEvent, 'v' | 'eventId'>;
