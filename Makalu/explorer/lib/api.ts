import { useState, useEffect, useCallback, useRef } from 'react';

const API_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Fetch from the REST API.
 * Nginx routes /api/* to our Express API on :8080 (mapped from :4000).
 */
export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // API returns JSON error bodies like {"statusCode":404,"message":"Block not found"}
    // Extract the human-readable message instead of showing raw JSON.
    let msg = `Request failed (${res.status})`;
    if (text) {
      try {
        const json = JSON.parse(text);
        msg = json.message || json.error || msg;
      } catch {
        msg = text;
      }
    }
    throw new Error(msg);
  }
  return res.json();
}

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(
  path: string | null,
  options?: { pollInterval?: number; initialData?: T }
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(options?.initialData ?? null);
  const [loading, setLoading] = useState(options?.initialData === undefined);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  const requestId = useRef(0);
  pathRef.current = path;
  // Skip setting loading=true on the first fetch when SSR data is already present
  const skipFirstLoading = useRef(options?.initialData !== undefined);

  const doFetch = useCallback(async () => {
    const requestedPath = pathRef.current;
    if (!requestedPath) return;
    const id = ++requestId.current;
    const isCurrent = () => id === requestId.current && requestedPath === pathRef.current;
    try {
      const result = await apiFetch<T>(requestedPath);
      if (!isCurrent()) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    if (!skipFirstLoading.current) {
      setLoading(true);
    }
    skipFirstLoading.current = false;
    doFetch();
    return () => { requestId.current++; };
  }, [path, doFetch]);

  useEffect(() => {
    if (!options?.pollInterval || !path) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (!active) return;
      timer = setTimeout(async () => {
        await doFetch();
        scheduleNext();
      }, options.pollInterval);
    };

    scheduleNext();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [doFetch, options?.pollInterval, path]);

  return { data, loading, error, refetch: doFetch };
}
