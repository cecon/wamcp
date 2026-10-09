import { useCallback, useEffect, useRef, useState } from 'react';
import { http, query, type Realtime } from '../api';
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
    [meta, setMeta] = useState<Meta>({ mine: 0, unassigned: 0, all: 0 }),
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
  useEffect(
    () =>
      realtime.subscribe(({ event }) => {
        if (!REFRESH.has(event)) return;
        clearTimeout(timer.current);
        // Bursts (message + activity + assignment) collapse into one refresh.
        timer.current = setTimeout(() => void load().catch(() => {}), 300);
      }),
    [realtime, load],
  );
  return {
    items,
    meta,
    hasMore,
    error,
    reload,
    more: () => void load(page + 1).catch((e: Error) => setError(e.message)),
  };
}
