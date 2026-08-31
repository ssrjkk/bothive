/**
 * Self-healing: shadowban detection, account warming, and auto-rotation.
 *
 * A bot that gets silently rate-limited or shadow-banned is worse than a bot
 * that crashes — it consumes resources while producing zero output.  This
 * module provides the detection heuristics and response strategies.
 */

/* -------------------------------------------------------------------------- */
/*  Shadowban / Rate-limit detection                                          */
/* -------------------------------------------------------------------------- */

export interface HealthSnapshot {
  /** Total actions attempted in the monitoring window. */
  attempted: number;
  /** Actions that received a non-error response. */
  succeeded: number;
  /** Actions that returned a 429 or platform-specific rate-limit. */
  rateLimited: number;
  /** Actions where the API responded but engagement dropped to zero (possible shadowban). */
  silentDrops: number;
  /** Timestamp of the last confirmed successful action. */
  lastSuccessAt: number;
}

export interface DetectionResult {
  /** Whether the bot appears to be throttled or shadow-banned. */
  flagged: boolean;
  /** Human-readable reason for the flag. */
  reason: string;
  /** Confidence score 0-1.  Above 0.7 should trigger a pause. */
  confidence: number;
  /** Recommended action. */
  recommendation: 'continue' | 'throttle' | 'pause' | 'rotate';
}

/**
 * Analyzes a health snapshot and returns a detection result.
 *
 * Detection rules:
 *  1. If success rate < 10% over ≥20 attempts → high confidence throttle.
 *  2. If rate-limited responses > 50% of attempts → rate-limit detection.
 *  3. If no success in > 30 minutes despite attempts → possible shadowban.
 *  4. If silent drops (0 engagement on sent messages) > 80% → shadowban.
 */
export function detectAnomaly(snapshot: HealthSnapshot): DetectionResult {
  const { attempted, succeeded, rateLimited, silentDrops, lastSuccessAt } = snapshot;

  if (attempted < 5) {
    return {
      flagged: false,
      reason: 'Insufficient data',
      confidence: 0,
      recommendation: 'continue',
    };
  }

  const successRate = succeeded / attempted;
  const rateLimitRate = rateLimited / attempted;
  const silentDropRate = silentDrops / attempted;
  const minutesSinceLastSuccess = (Date.now() - lastSuccessAt) / 60_000;

  // Rule 1: Severe throttle — almost nothing gets through.
  if (successRate < 0.1 && attempted >= 20) {
    return {
      flagged: true,
      reason: `Success rate ${(successRate * 100).toFixed(1)}% over ${attempted} attempts`,
      confidence: 0.9,
      recommendation: 'pause',
    };
  }

  // Rule 2: Rate-limit flood.
  if (rateLimitRate > 0.5) {
    return {
      flagged: true,
      reason: `Rate-limited on ${(rateLimitRate * 100).toFixed(1)}% of ${attempted} attempts`,
      confidence: 0.85,
      recommendation: 'throttle',
    };
  }

  // Rule 3: Extended silence despite attempts.
  if (minutesSinceLastSuccess > 30 && attempted >= 10) {
    return {
      flagged: true,
      reason: `No success in ${Math.round(minutesSinceLastSuccess)} minutes despite ${attempted} attempts`,
      confidence: 0.75,
      recommendation: 'rotate',
    };
  }

  // Rule 4: Shadowban — messages go out but get zero engagement.
  if (silentDropRate > 0.8 && attempted >= 10) {
    return {
      flagged: true,
      reason: `Silent drops on ${(silentDropRate * 100).toFixed(1)}% of messages (possible shadowban)`,
      confidence: 0.7,
      recommendation: 'pause',
    };
  }

  return { flagged: false, reason: 'Normal behavior', confidence: 0, recommendation: 'continue' };
}

/* -------------------------------------------------------------------------- */
/*  Account warming                                                           */
/* -------------------------------------------------------------------------- */

export interface WarmingConfig {
  /** Total warming duration in days. Default 5. */
  durationDays: number;
  /** Maximum "actions" (likes, views) per day during warming. Default 5. */
  maxDailyActions: number;
  /** Maximum messages/posts per day during warming. Default 2. */
  maxDailyPosts: number;
  /** Day (1-based) when the first post is allowed. Default 3. */
  firstPostDay: number;
}

export const DEFAULT_WARMING_CONFIG: WarmingConfig = {
  durationDays: 5,
  maxDailyActions: 5,
  maxDailyPosts: 2,
  firstPostDay: 3,
};

export interface WarmingState {
  /** ISO date when warming started. */
  startedAt: string;
  /** Actions taken today. */
  todayActions: number;
  /** Posts made today. */
  todayPosts: number;
  /** Date of the last action (for daily reset). */
  lastActionDate: string;
}

/**
 * Returns the allowed actions for today during the warming phase.
 */
export function warmingLimits(
  state: WarmingState,
  config: WarmingConfig = DEFAULT_WARMING_CONFIG,
  now: Date = new Date(),
): { canAct: boolean; canPost: boolean; reason: string; daysRemaining: number } {
  const started = new Date(state.startedAt);
  const dayNumber = Math.floor((now.getTime() - started.getTime()) / 86_400_000) + 1;

  if (dayNumber > config.durationDays) {
    return { canAct: true, canPost: true, reason: 'Warming complete', daysRemaining: 0 };
  }

  const todayActionsRemaining = Math.max(0, config.maxDailyActions - state.todayActions);
  const todayPostsRemaining = Math.max(0, config.maxDailyPosts - state.todayPosts);
  const canPost = dayNumber >= config.firstPostDay && todayPostsRemaining > 0;

  return {
    canAct: todayActionsRemaining > 0,
    canPost,
    reason: canPost
      ? `Warming day ${dayNumber}/${config.durationDays}`
      : `Warming day ${dayNumber}/${config.durationDays} — posting not yet allowed`,
    daysRemaining: Math.max(0, config.durationDays - dayNumber),
  };
}

/* -------------------------------------------------------------------------- */
/*  Auto-rotation on anomaly                                                  */
/* -------------------------------------------------------------------------- */

export interface RotationAction {
  type: 'pause' | 'change_proxy' | 'alert' | 'cool_down';
  /** Duration in ms for pause/cool_down actions. */
  durationMs?: number;
  /** Human-readable explanation. */
  reason: string;
}

/**
 * Given a detection result, produces the recommended rotation actions.
 */
export function planRotation(detection: DetectionResult): RotationAction[] {
  const actions: RotationAction[] = [];

  switch (detection.recommendation) {
    case 'pause':
      actions.push({ type: 'pause', durationMs: 30 * 60_000, reason: detection.reason });
      actions.push({ type: 'change_proxy', reason: 'Switch proxy after pause' });
      actions.push({ type: 'alert', reason: `Bot flagged: ${detection.reason}` });
      break;
    case 'throttle':
      actions.push({ type: 'cool_down', durationMs: 10 * 60_000, reason: detection.reason });
      actions.push({ type: 'change_proxy', reason: 'Rotate proxy to reduce rate-limit pressure' });
      break;
    case 'rotate':
      actions.push({ type: 'change_proxy', reason: detection.reason });
      actions.push({ type: 'alert', reason: `Possible shadowban: ${detection.reason}` });
      break;
    default:
      break;
  }

  return actions;
}
