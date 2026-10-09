import { useCallback, useEffect, useState } from 'react';
import { http, type Realtime } from '../api';
import type { AppNotification } from '../types';

type Unread = { unread: number };

/** The agent's notification feed: loads, follows `notification.created` and runs the item actions. */
export function useNotifications(realtime: Realtime, onUnread: (count: number) => void) {
  const [items, setItems] = useState<AppNotification[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await http<{ items: AppNotification[]; unread: number }>('/notifications');
    setItems(result.items);
    setLoaded(true);
    onUnread(result.unread);
  }, [onUnread]);
  useEffect(() => {
    const initial = setTimeout(() => void load().catch((e: Error) => setError(e.message)), 0);
    const unsubscribe = realtime.subscribe(({ event }) => {
      if (event === 'notification.created') void load().catch(() => {});
    });
    return () => {
      clearTimeout(initial);
      unsubscribe();
    };
  }, [load, realtime]);

  /** Every action answers with the unread count; the list is then reloaded from the server. */
  const act = (path: string, method: string, body?: unknown) => {
    setError('');
    return http<Unread>(path, method, body)
      .then((r) => onUnread(r.unread))
      .then(load)
      .catch((e: Error) => setError(e.message));
  };
  const one = (n: AppNotification) => `/notifications/${n.id}`;
  return {
    items,
    loaded,
    error,
    read: (n: AppNotification) => (n.read_at ? Promise.resolve() : act(one(n), 'PATCH', {})),
    unread: (n: AppNotification) => act(`${one(n)}/unread`, 'POST'),
    snooze: (n: AppNotification, until: number) => act(`${one(n)}/snooze`, 'POST', { snoozed_until: until }),
    remove: (n: AppNotification) => act(one(n), 'DELETE'),
    readAll: () => act('/notifications/read_all', 'POST'),
    destroyAll: () => act('/notifications/destroy_all', 'POST'),
  };
}
export type Notifications = ReturnType<typeof useNotifications>;
