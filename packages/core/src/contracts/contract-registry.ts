import type { Platform } from '../types/bot.js';
import type { PlatformEventInput } from '../types/events.js';

/**
 * Versioned event contracts.
 *
 * Every platform mutates its API and event shapes over time (Twitter/X being
 * the poster child), so a bot farm that treats all events as one flat schema
 * silently breaks when a provider adds/renames a field or changes semantics.
 * This registry is the single source of truth for the schema version of every
 * (platform, eventType) pair. Workers stamp every emitted event with its
 * contract version (`PlatformEvent.v`), the event store persists it, webhook
 * consumers see it in the envelope, and replay logic re-runs an event under
 * the version it was originally produced with — so a platform migration never
 * corrupts historical events.
 */

/** Current envelope format version, reported on every webhook delivery. */
export const EVENT_ENVELOPE_VERSION = '1';

/** Current contract version for all known (platform, eventType) pairs. */
export const EVENT_CONTRACT_VERSION = 1;

/**
 * Explicit per-platform, per-event-type contract versions. Absent entries fall
 * back to EVENT_CONTRACT_VERSION. Bump the entry (never lower it) when a
 * provider changes the payload shape for that event type, and add a migration
 * for consumers. The crypto platform has no live social contract — its events
 * are derived, so they share the base version.
 */
const CONTRACT_VERSIONS: Record<Platform, Partial<Record<string, number>>> = {
  telegram: { message: 1 },
  twitch: { message: 1, follow: 1, subscribe: 1, donation: 1, comment: 1, raid: 1, host: 1 },
  youtube: { message: 1, follow: 1, subscribe: 1, donation: 1, comment: 1 },
  twitter: { message: 1, follow: 1, comment: 1, donation: 1 },
  crypto: { price: 1, signal: 1, trade: 1 },
  discord: { message: 1, reaction: 1, member_join: 1 },
  slack: { message: 1, reaction: 1, member_join: 1, team_join: 1 },
  bluesky: { like: 1, repost: 1, follow: 1, reply: 1, mention: 1, quote: 1, notification: 1 },
};

export const PLATFORMS: Platform[] = [
  'telegram',
  'twitch',
  'youtube',
  'twitter',
  'crypto',
  'discord',
  'slack',
  'bluesky',
];

/** Resolves the current contract version for a (platform, eventType) pair. */
export function contractVersion(platform: string, type: string): number {
  const byType = CONTRACT_VERSIONS[platform as Platform];
  const explicit = byType?.[type];
  return explicit ?? EVENT_CONTRACT_VERSION;
}

/** Whether a stored/produced version is still consumable under the current contract. */
export function isContractSupported(platform: string, type: string, version: number): boolean {
  if (!Number.isFinite(version)) return false;
  return version >= 1 && version <= contractVersion(platform, type);
}

/** Throws when an event version is newer than the current contract supports. */
export function assertContractSupported(platform: string, type: string, version: number): void {
  if (!isContractSupported(platform, type, version)) {
    throw new Error(
      `Unsupported event contract v${version} for ${platform}/${type} ` +
        `(current: v${contractVersion(platform, type)})`,
    );
  }
}

/**
 * A snapshot of every currently supported contract version, so operators and
 * dashboards can see at a glance what each platform/event actually carries.
 */
export function latestContractVersions(): Record<Platform, Record<string, number>> {
  const out = {} as Record<Platform, Record<string, number>>;
  for (const platform of PLATFORMS) {
    const versions: Record<string, number> = {};
    const keys = new Set([...Object.keys(CONTRACT_VERSIONS[platform] ?? {}), 'error']);
    for (const type of keys) versions[type] = contractVersion(platform, type);
    out[platform] = versions;
  }
  return out;
}

/**
 * Stamps a raw event with its contract version (`v`) — the single funnel every
 * worker uses before emitting, so no event can leave a worker without a
 * version.
 */
export function stampContractVersion<E extends PlatformEventInput>(event: E): E & { v: number } {
  return { ...event, v: contractVersion(event.platform, event.type) };
}
