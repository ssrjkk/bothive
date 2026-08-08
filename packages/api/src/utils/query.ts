export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max?: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return max !== undefined ? Math.min(parsed, max) : parsed;
}

const MAX_SKIP = 100_000;

export function parsePage(
  query: Record<string, unknown>,
  defaults: { limit: number; maxLimit: number },
): { take: number; skip: number } {
  const take = parsePositiveInt(
    typeof query.limit === 'string' ? query.limit : undefined,
    defaults.limit,
    defaults.maxLimit,
  );
  const skip = Math.min(
    parsePositiveInt(typeof query.offset === 'string' ? query.offset : undefined, 0),
    MAX_SKIP,
  );
  return { take, skip };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
