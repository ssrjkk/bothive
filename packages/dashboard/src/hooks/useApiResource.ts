import { useCallback, useEffect, useRef, useState } from 'react';

interface UseApiResourceOptions {
  /** Re-run the loader when any of these change (e.g. table filters). */
  deps?: unknown[];
  /** Re-run the loader on an interval (dashboards with auto-refresh). */
  intervalMs?: number;
  /** Once data has loaded, keep it on screen and stay silent on refetch errors. */
  silentRefetch?: boolean;
  /** Also flip `loading` on every reload, not just the first one. */
  refetchLoading?: boolean;
}

/**
 * Standard "load a resource, surface errors, allow retry" plumbing that every
 * page used to hand-roll: three `useState` calls plus a fetch function plus a
 * `useEffect`. Returns `data`/`setData`/`loading`/`error`/`reload`.
 */
export function useApiResource<T>(loader: () => Promise<T>, options: UseApiResourceOptions = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasData = useRef(false);
  const seqRef = useRef(0);

  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(
    () => () => {
      seqRef.current += 1;
    },
    [],
  );

  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    if (options.refetchLoading || !hasData.current) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (seq !== seqRef.current) return;
      setData(result);
      setError(null);
      hasData.current = true;
    } catch (e) {
      if (seq !== seqRef.current) return;
      if (!options.silentRefetch || !hasData.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [options.refetchLoading, options.silentRefetch]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...(options.deps ?? [])]);

  useEffect(() => {
    if (!options.intervalMs) return;
    const timer = setInterval(() => void reload(), options.intervalMs);
    return () => clearInterval(timer);
  }, [options.intervalMs, reload]);

  return { data, setData, loading, error, reload };
}
