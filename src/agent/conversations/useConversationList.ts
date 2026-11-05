import { useCallback, useEffect, useRef, useState } from 'react';
import { http, query, REALTIME_RECONNECTED, type Realtime } from '../api';
import type { Conversation, Meta } from '../types';
import type { Route } from '../route';
import type { AssigneeType, StatusFilter } from './ChatList';

type ConversationsRoute = Extract<Route, { page: 'conversations' }>;
const REFRESH = new Set([
  'conversation.created',
  'conversation.updated',
  'conversation.status_changed',
  'conversation.bot_handoff',
  'assignee.changed',
  'team.changed',
  'message.created',
  REALTIME_RECONNECTED,
]);
const PAGE = 25;

interface Options {
  route: ConversationsRoute;
  status: StatusFilter;
  tab: AssigneeType;
  sort: string;
  realtime: Realtime;
}

/** Loads the chat list (regular scopes or the advanced filter), paginates and refreshes on events. */
export function useConversationList({ route, status, tab, sort, realtime }: Options) {
  const [items, setItems] = useState<Conversation[]>([]),
    [meta, setMeta] = useState<Meta>({ mine: 0, unassigned: 0, ai: 0, all: 0 }),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { inboxId, teamId, label, q, conversationType, filters } = route;

  const load = useCallback(
    async (nextPage = 1) => {
      let list: Conversation[];
      if (filters) {
        list = await http<Conversation[]>(`/conversations/filter${query({ page: nextPage })}`, 'POST', {
          payload: filters,
        });
      } else {
        const base = {
          status,
          inbox_id: inboxId,
          team_id: teamId,
          label,
          q,
          conversation_type: conversationType,
        };
        const [found, counts] = await Promise.all([
          http<Conversation[]>(
            `/conversations${query({ ...base, assignee_type: tab, sort_by: sort, page: nextPage })}`,
          ),
          http<Meta>(`/conversations/meta${query(base)}`),
        ]);
        list = found;
        setMeta(counts);
      }
      setItems((current) => (nextPage === 1 ? list : [...current, ...list]));
      setHasMore(list.length === PAGE);
      setPage(nextPage);
      setError('');
    },
    [status, tab, sort, inboxId, teamId, label, q, conversationType, filters],
  );
  const reload = useCallback(() => void load().catch((e: Error) => setError(e.message)), [load]);
  useEffect(() => {
    const handle = setTimeout(reload, 0);
    return () => clearTimeout(handle);
  }, [reload]);
  /** Bursts (message + activity + assignment, or an action and its own event) collapse into one refresh. */
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load().catch(() => {}), 300);
  }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(
    () =>
      realtime.subscribe(({ event }) => {
        if (REFRESH.has(event)) refresh();
      }),
    [realtime, refresh],
  );
  /**
   * A change made in this tab (resolve, assign, read): the card shows it at once and the counters and
   * tab membership are fetched again, without waiting for the realtime stream to echo it back.
   */
  const apply = useCallback(
    (changed: Conversation) => {
      setItems((list) => list.map((c) => (c.id === changed.id ? { ...c, ...changed } : c)));
      refresh();
    },
    [refresh],
  );
  return {
    items,
    meta,
    hasMore,
    error,
    reload,
    refresh,
    apply,
    more: () => void load(page + 1).catch((e: Error) => setError(e.message)),
  };
}
