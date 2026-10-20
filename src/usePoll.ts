import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetches now, then every `intervalMs` while the tab is visible, and again when it
 * becomes visible. Keeps Cloudflare's free request quota safe when tabs sit open.
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      const next = await loadRef.current();
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err as Error);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setData(null);
    setError(null);
    refresh();
    let timer: number | undefined;
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState === "visible") timer = window.setInterval(refresh, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, intervalMs]);

  return { data, setData, error, refresh };
}
