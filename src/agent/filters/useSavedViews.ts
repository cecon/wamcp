import { useCallback, useEffect, useState } from 'react';
import { http, query } from '../api';
import type { CustomFilter, FilterType } from '../types';

/** The agent's saved views (Chatwoot custom filters / folders) of one type. */
export function useSavedViews(filterType: FilterType) {
  const [views, setViews] = useState<CustomFilter[]>([]);
  const reload = useCallback(
    () =>
      http<CustomFilter[]>(`/custom_filters${query({ filter_type: filterType })}`)
        .then(setViews)
        .catch(() => setViews([])),
    [filterType],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { views, reload };
}
