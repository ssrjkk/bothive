export interface WorkerHeartbeat {
  ts: number;
  concurrency?: number;
  version?: string;
}

/**
 * Parses a worker heartbeat value into { ts, concurrency, version }. New
 * workers publish a JSON payload; the numeric-only format from older versions
 * is accepted so a rolling deployment never breaks the API health endpoint.
 */
export function parseWorkerHeartbeat(raw: string | number): WorkerHeartbeat {
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(String(raw).trim())) {
    return { ts: numeric };
  }
  try {
    const parsed = JSON.parse(String(raw)) as { ts?: unknown; concurrency?: unknown; version?: unknown };
    return {
      ts: typeof parsed.ts === 'number' ? parsed.ts : Number(parsed.ts) || 0,
      concurrency: typeof parsed.concurrency === 'number' ? parsed.concurrency : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    };
  } catch {
    return { ts: 0 };
  }
}
