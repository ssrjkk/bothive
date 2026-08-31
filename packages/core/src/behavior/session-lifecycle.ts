/**
 * Session lifecycle manager — "wake/sleep" cycles for bots.
 *
 * A bot running 24/7 is a trivially detectable anomaly.  Real users have
 * circadian rhythms: activity peaks in the morning and evening, with a long
 * "sleep" window during the night.  This module computes whether a bot should
 * be active right now based on a configurable human schedule.
 *
 * The schedule is defined as a set of "active windows" (hour ranges) per day
 * of week, with a global timezone.  Outside those windows the bot is "asleep"
 * and the worker should not process events or send messages.
 *
 * The schedule intentionally has jitter — the wake/sleep transitions are not
 * on exact hour boundaries but drift by ±15 minutes to avoid fleet-wide
 * synchronized sleep patterns that platforms could fingerprint.
 */

export interface ActiveWindow {
  /** Hour of day (0-23) when the window opens. */
  startHour: number;
  /** Minute (0-59) when the window opens. */
  startMinute: number;
  /** Hour of day (0-23) when the window closes. */
  endHour: number;
  /** Minute (0-59) when the window closes. */
  endMinute: number;
}

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

/**
 * Per-bot human-like behavior config, read from `bot.config.behavior`.
 * When `enabled`, the worker pauses activity (and stalls reconnects) outside
 * the configured wake/sleep schedule.
 */
export interface HumanBehaviorConfig {
  enabled: boolean;
  schedule?: LifecycleSchedule;
  timezone?: string;
}

export interface LifecycleSchedule {
  /** Per-day-of-week active windows.  Missing days default to empty (asleep). */
  activeWindows: Partial<Record<DayOfWeek, ActiveWindow[]>>;
  /** IANA timezone name (e.g. "Europe/Moscow").  Defaults to "UTC". */
  timezone?: string;
  /** Random jitter (ms) added/subtracted from wake/sleep transitions. Default ±15min. */
  jitterMs?: number;
}

/**
 * A common "human" schedule:
 *  - Active 08:00–12:00 and 17:00–23:00 on weekdays
 *  - Active 10:00–01:00 on weekends (later nights)
 *  - Completely asleep 02:00–07:00 on weekends, 00:00–08:00 on weekdays
 */
export const HUMAN_DEFAULT_SCHEDULE: LifecycleSchedule = {
  activeWindows: {
    1: [
      { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      { startHour: 17, startMinute: 0, endHour: 23, endMinute: 0 },
    ],
    2: [
      { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      { startHour: 17, startMinute: 0, endHour: 23, endMinute: 0 },
    ],
    3: [
      { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      { startHour: 17, startMinute: 0, endHour: 23, endMinute: 0 },
    ],
    4: [
      { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      { startHour: 17, startMinute: 0, endHour: 23, endMinute: 0 },
    ],
    5: [
      { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      { startHour: 17, startMinute: 0, endHour: 23, endMinute: 0 },
    ],
    6: [{ startHour: 10, startMinute: 0, endHour: 24, endMinute: 0 }],
    0: [{ startHour: 10, startMinute: 0, endHour: 1, endMinute: 0 }],
  },
  timezone: 'UTC',
  jitterMs: 15 * 60 * 1000, // ±15 minutes
};

/* -------------------------------------------------------------------------- */
/*  Core logic                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Returns `true` if the bot should be active at the given timestamp according
 * to the schedule.  Accounts for the configured timezone and jitter.
 */
export function shouldBeActive(now: Date, schedule: LifecycleSchedule): boolean {
  const tz = schedule.timezone ?? 'UTC';
  const jitter = schedule.jitterMs ?? 15 * 60 * 1000;

  // Get the local day/hour/minute in the configured timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';

  const dayMap: Record<string, DayOfWeek> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = dayMap[weekdayStr] ?? 0;
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const currentMinutes = hour * 60 + minute;

  const windows = schedule.activeWindows[day] ?? [];
  for (const w of windows) {
    const start = w.startHour * 60 + w.startMinute;
    const end = w.endHour * 60 + w.endMinute;

    // Apply jitter to window boundaries.
    const jitterMinutes = Math.round(jitter / 60000);
    const jitteredStart = Math.max(0, start - jitterMinutes);
    const jitteredEnd = Math.min(24 * 60, end + jitterMinutes);

    if (start <= end) {
      // Normal window (e.g. 08:00–12:00)
      if (currentMinutes >= jitteredStart && currentMinutes <= jitteredEnd) return true;
    } else {
      // Overnight window (e.g. 22:00–02:00)
      if (currentMinutes >= jitteredStart || currentMinutes <= jitteredEnd) return true;
    }
  }

  return false;
}

/**
 * Returns the number of milliseconds until the next wake/sleep transition.
 * Useful for scheduling the next check or putting the bot into a Redis-backed
 * "sleep" state with a TTL.
 *
 * @returns `{ untilMs, action }` where `action` is `'wake'` or `'sleep'`.
 */
export function nextTransition(
  now: Date,
  schedule: LifecycleSchedule,
): { untilMs: number; action: 'wake' | 'sleep' } {
  const tz = schedule.timezone ?? 'UTC';
  const jitter = schedule.jitterMs ?? 15 * 60 * 1000;

  const currentlyActive = shouldBeActive(now, schedule);

  // Walk through every minute of the next 48 hours to find the first transition.
  const MS_PER_MINUTE = 60_000;
  for (let offset = 1; offset <= 48 * 60; offset++) {
    const candidate = new Date(now.getTime() + offset * MS_PER_MINUTE);
    const willBeActive = shouldBeActive(candidate, schedule);
    if (willBeActive !== currentlyActive) {
      const jitterOffset = Math.round(((Math.random() - 0.5) * 2 * jitter) / MS_PER_MINUTE);
      const adjustedOffset = Math.max(1, offset + jitterOffset);
      return {
        untilMs: adjustedOffset * MS_PER_MINUTE,
        action: willBeActive ? 'wake' : 'sleep',
      };
    }
  }

  // Fallback: check again in 30 minutes.
  return { untilMs: 30 * 60 * 1000, action: currentlyActive ? 'sleep' : 'wake' };
}
