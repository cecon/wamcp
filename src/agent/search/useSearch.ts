import { useEffect, useState } from 'react';
import { query } from '../api';
import type { SearchResults, SearchType } from '../parityTypes';
import { useFetch } from '../useFetch';

export const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

/** Global search (GET /search) once the term has 2+ characters and the agent stopped typing. */
export function useSearch(term: string, type: SearchType) {
  const trimmed = term.trim();
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const ready = debounced.length >= MIN_CHARS;
  const { data, error, loading } = useFetch<SearchResults>(
    ready ? `/search${query({ q: debounced, type })}` : null,
  );
  return {
    term: debounced,
    results: ready ? data : null,
    error: ready ? error : '',
    searching: trimmed.length >= MIN_CHARS && (loading || debounced !== trimmed),
  };
}
