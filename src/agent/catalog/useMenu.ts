import { useEffect } from 'react';
import type { Realtime } from '../api';
import { useFetch } from '../useFetch';
import type { ComplementGroup, Menu } from './types';

/** Reloads `reload` whenever the server reports a catalog change (SSE `catalog.updated`). */
function useCatalogUpdates(realtime: Realtime | undefined, reload: () => void) {
  useEffect(
    () =>
      realtime?.subscribe(({ event }) => {
        if (event === 'catalog.updated') reload();
      }),
    [realtime, reload],
  );
}

/** The full menu (GET /catalog), kept fresh by realtime events. */
export function useMenu(realtime?: Realtime) {
  const { data, error, reload } = useFetch<Menu>('/catalog');
  useCatalogUpdates(realtime, reload);
  return { menu: data, error, reload };
}

/** The complements library (GET /catalog/groups), kept fresh by realtime events. */
export function useGroups(realtime?: Realtime) {
  const { data, error, reload } = useFetch<ComplementGroup[]>('/catalog/groups');
  useCatalogUpdates(realtime, reload);
  return { groups: data || [], error, reload };
}
