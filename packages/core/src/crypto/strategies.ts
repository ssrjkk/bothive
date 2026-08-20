export type StrategyKind = 'sma' | 'rsi' | 'alert';
export type SignalDirection = 'buy' | 'sell';

export interface StrategySignal {
  direction: SignalDirection;
  reason: string;
  price: number;
}

export interface StrategyParams {
  fastPeriod?: number;
  slowPeriod?: number;
  period?: number;
  oversold?: number;
  overbought?: number;
  upThreshold?: number;
  downThreshold?: number;
}

export function sma(values: number[], period: number): number | null {
  if (!Number.isInteger(period) || period < 1) return null;
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function smaCross(closes: number[], fast: number, slow: number): SignalDirection | null {
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 1 || fast >= slow) return null;
  if (closes.length < slow + 1) return null;
  const prevFast = sma(closes.slice(0, -1), fast);
  const prevSlow = sma(closes.slice(0, -1), slow);
  const curFast = sma(closes, fast);
  const curSlow = sma(closes, slow);
  if (prevFast === null || prevSlow === null || curFast === null || curSlow === null) return null;
  if (prevFast <= prevSlow && curFast > curSlow) return 'buy';
  if (prevFast >= prevSlow && curFast < curSlow) return 'sell';
  return null;
}

export function rsi(closes: number[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 2) return null;
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function rsiSignal(
  closes: number[],
  period: number,
  oversold: number,
  overbought: number,
): SignalDirection | null {
  const value = rsi(closes, period);
  if (value === null) return null;
  if (value <= oversold) return 'buy';
  if (value >= overbought) return 'sell';
  return null;
}

export function alertSignal(
  current: number,
  previous: number,
  upThreshold?: number,
  downThreshold?: number,
): SignalDirection | null {
  if (upThreshold !== undefined && previous <= upThreshold && current > upThreshold) return 'buy';
  if (downThreshold !== undefined && previous >= downThreshold && current < downThreshold) {
    return 'sell';
  }
  return null;
}

/**
 * Validates user-supplied strategy parameters for a strategy kind. Returns a
 * list of human-readable problems (empty means the params are acceptable).
 * Only the parameters that were actually provided are checked; missing ones
 * fall back to sane defaults at evaluation time.
 */
export function validateStrategyParams(
  kind: StrategyKind,
  params: StrategyParams | undefined,
): string[] {
  const problems: string[] = [];
  if (!params) return problems;
  const p = params as Record<string, unknown>;

  const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

  if (kind === 'sma') {
    if (p.fastPeriod !== undefined) {
      if (!Number.isInteger(p.fastPeriod) || (p.fastPeriod as number) < 1) {
        problems.push('sma.fastPeriod must be a positive integer');
      }
    }
    if (p.slowPeriod !== undefined) {
      if (!Number.isInteger(p.slowPeriod) || (p.slowPeriod as number) < 2) {
        problems.push('sma.slowPeriod must be an integer of at least 2');
      }
    }
    if (
      Number.isInteger(p.fastPeriod) &&
      Number.isInteger(p.slowPeriod) &&
      (p.slowPeriod as number) <= (p.fastPeriod as number)
    ) {
      problems.push('sma.slowPeriod must be greater than fastPeriod');
    }
  }

  if (kind === 'rsi') {
    if (p.period !== undefined && (!Number.isInteger(p.period) || (p.period as number) < 2)) {
      problems.push('rsi.period must be an integer of at least 2');
    }
    for (const key of ['oversold', 'overbought'] as const) {
      if (p[key] !== undefined && (!finite(p[key]) || p[key] <= 0 || p[key] >= 100)) {
        problems.push(`rsi.${key} must be between 0 and 100`);
      }
    }
    if (finite(p.oversold) && finite(p.overbought) && p.oversold >= p.overbought) {
      problems.push('rsi.oversold must be lower than overbought');
    }
  }

  if (kind === 'alert') {
    if (p.upThreshold !== undefined && (!finite(p.upThreshold) || p.upThreshold <= 0)) {
      problems.push('alert.upThreshold must be a positive number');
    }
    if (p.downThreshold !== undefined && (!finite(p.downThreshold) || p.downThreshold <= 0)) {
      problems.push('alert.downThreshold must be a positive number');
    }
    if (finite(p.upThreshold) && finite(p.downThreshold) && p.upThreshold <= p.downThreshold) {
      problems.push('alert.upThreshold must be greater than downThreshold');
    }
  }

  // Exit-management params apply to every strategy kind; 0 disables the guard.
  for (const key of ['stopLossPct', 'takeProfitPct', 'trailingStopPct'] as const) {
    if (p[key] !== undefined && (!finite(p[key]) || p[key] < 0)) {
      problems.push(`${key} must be a non-negative number`);
    }
  }

  return problems;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function evaluateStrategy(
  kind: StrategyKind,
  params: StrategyParams | undefined,
  closes: number[],
  currentPrice: number,
  previousPrice: number,
): StrategySignal | null {
  switch (kind) {
    case 'sma': {
      const fast = Math.floor(numberParam(params?.fastPeriod, 9));
      const slow = Math.floor(numberParam(params?.slowPeriod, 21));
      const direction = smaCross(closes, fast, slow);
      return direction
        ? { direction, reason: `SMA ${fast}/${slow} cross`, price: currentPrice }
        : null;
    }
    case 'rsi': {
      const period = Math.floor(numberParam(params?.period, 14));
      const oversold = numberParam(params?.oversold, 30);
      const overbought = numberParam(params?.overbought, 70);
      const value = rsi(closes, period);
      const direction = rsiSignal(closes, period, oversold, overbought);
      if (!direction || value === null) return null;
      const bound = direction === 'buy' ? oversold : overbought;
      return {
        direction,
        reason: `RSI ${value.toFixed(1)} crossed ${bound}`,
        price: currentPrice,
      };
    }
    case 'alert': {
      const up = numberParam(params?.upThreshold, Number.NaN);
      const down = numberParam(params?.downThreshold, Number.NaN);
      const direction = alertSignal(
        currentPrice,
        previousPrice,
        Number.isFinite(up) ? up : undefined,
        Number.isFinite(down) ? down : undefined,
      );
      return direction
        ? {
            direction,
            reason: `Price ${direction === 'buy' ? 'broke above' : 'broke below'} threshold`,
            price: currentPrice,
          }
        : null;
    }
    default:
      return null;
  }
}
