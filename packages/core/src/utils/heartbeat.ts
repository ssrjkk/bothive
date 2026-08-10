export interface WorkerHeartbeat {
  ts: number;
  concurrency?: number;
  version?: string;
  /** Process RSS in bytes, sampled at heartbeat time. */
  rss?: number;
  /** V8 heap used in bytes. */
  heapUsed?: number;
  /** V8 heap total in bytes. */
  heapTotal?: number;
  /** Queue wait time percentiles in seconds (p50/p95/p99). */
  waitP50?: number;
  waitP95?: number;
  waitP99?: number;
  /** Number of live script-sandbox worker threads in this process. */
  sandboxWorkers?: number;
}

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses a worker heartbeat value into { ts, concurrency, version, rss,
 * heapUsed, heapTotal, waitP50, waitP95, waitP99, sandboxWorkers }. New workers
 * publish a JSON payload; the numeric-only format from older versions is
 * accepted so a rolling deployment never breaks the API health endpoint.
 * Unknown fields are dropped.
 */
export function parseWorkerHeartbeat(raw: string | number): WorkerHeartbeat {
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(String(raw).trim())) {
    return { ts: numeric };
  }
  try {
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    return {
      ts: finiteNumber(parsed.ts) ?? 0,
      concurrency: finiteNumber(parsed.concurrency),
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
      rss: finiteNumber(parsed.rss),
      heapUsed: finiteNumber(parsed.heapUsed),
      heapTotal: finiteNumber(parsed.heapTotal),
      waitP50: finiteNumber(parsed.waitP50),
      waitP95: finiteNumber(parsed.waitP95),
      waitP99: finiteNumber(parsed.waitP99),
      sandboxWorkers: finiteNumber(parsed.sandboxWorkers),
    };
  } catch {
    return { ts: 0 };
  }
}
