import { useCallback, useEffect, useState } from 'react';
import { http } from './api';

interface State<T> {
  path: string | null;
  data: T | null;
  error: string;
}

/**
 * GETs `path` whenever it changes (nothing when `null`); stale responses are ignored and the
 * previous data stays visible while the next request runs.
 */
export function useFetch<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ path: null, data: null, error: '' }),
    [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    http<T>(path)
      .then((data) => live && setState({ path, data, error: '' }))
      .catch((e: Error) => live && setState({ path, data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.path !== path, reload };
}
