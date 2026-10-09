import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { http, query, type Realtime } from '../api';
import type { Catalog, Conversation, Meta, User } from '../types';
import type { Route } from '../route';
import { cn } from '../ui/cn';
import { ChatList, type AssigneeType, type StatusFilter } from './ChatList';
import { ConversationBox } from './ConversationBox';

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

interface Props {
  route: ConversationsRoute;
  user: User;
  catalog: Catalog;
  realtime: Realtime;
  onNavigate: (route: Route) => void;
}

/** Chatwoot ConversationView: ChatList | ConversationBox | ContactPanel. */
export function ConversationsScreen({ route, user, catalog, realtime, onNavigate }: Props) {
  const [status, setStatus] = useState<StatusFilter>('open'),
    [tab, setTab] = useState<AssigneeType>('me'),
    [items, setItems] = useState<Conversation[]>([]),
    [meta, setMeta] = useState<Meta>({ mine: 0, unassigned: 0, all: 0 }),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { inboxId, teamId, label, q, displayId } = route;

  const load = useCallback(
    async (nextPage = 1) => {
      const base = { status, inbox_id: inboxId, team_id: teamId, label, q };
      const [list, counts] = await Promise.all([
        http<Conversation[]>(`/conversations${query({ ...base, assignee_type: tab, page: nextPage })}`),
        http<Meta>(`/conversations/meta${query(base)}`),
      ]);
      setItems((current) => (nextPage === 1 ? list : [...current, ...list]));
      setHasMore(list.length === 25);
      setPage(nextPage);
      setMeta(counts);
      setError('');
    },
    [status, tab, inboxId, teamId, label, q],
  );
  useEffect(() => {
    const handle = setTimeout(() => void load().catch((e: Error) => setError(e.message)), 0);
    return () => clearTimeout(handle);
  }, [load]);
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

  const title = inboxId
    ? catalog.inboxes.find((i) => i.id === inboxId)?.name || 'Caixa de entrada'
    : teamId
      ? catalog.teams.find((t) => t.id === teamId)?.name || 'Time'
      : label
        ? `#${label}`
        : q
          ? `Busca: “${q}”`
          : 'Conversas';
  const select = (id: number | undefined) => onNavigate({ ...route, displayId: id });

  return (
    <div className="flex h-full w-full">
      <div className={cn('h-full w-full md:w-auto', displayId ? 'hidden md:block' : false)}>
        <ChatList
          title={title}
          items={items}
          meta={meta}
          status={status}
          tab={tab}
          catalog={catalog}
          selected={displayId}
          hasMore={hasMore}
          error={error}
          onStatus={setStatus}
          onTab={setTab}
          onSelect={select}
          onMore={() => void load(page + 1)}
        />
      </div>
      {displayId ? (
        <ConversationBox
          key={displayId}
          displayId={displayId}
          user={user}
          catalog={catalog}
          realtime={realtime}
          onBack={() => select(undefined)}
          onOpen={select}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-2 border-l border-n-weak bg-n-surface-1 text-n-slate-11 md:flex">
          <MessageCircle size={40} className="text-n-slate-8" />
          <p className="text-base font-medium text-n-slate-12">Selecione uma conversa</p>
          <p className="text-sm">As mensagens do WhatsApp chegam aqui em tempo real.</p>
        </div>
      )}
    </div>
  );
}
