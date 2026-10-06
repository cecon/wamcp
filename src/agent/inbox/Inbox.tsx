import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { http, query, type Realtime } from '../api';
import type { Catalog, Conversation, Meta, User } from '../types';
import { ConversationList, type Filters } from './ConversationList';
import { ConversationView } from './ConversationView';

interface Props {
  user: User;
  catalog: Catalog;
  realtime: Realtime;
  selected: number | null;
  onSelect: (displayId: number | null) => void;
}

const REFRESH_EVENTS = new Set([
  'conversation.created',
  'conversation.updated',
  'conversation.status_changed',
  'conversation.bot_handoff',
  'assignee.changed',
  'team.changed',
  'message.created',
]);

export function Inbox({ user, catalog, realtime, selected, onSelect }: Props) {
  const [filters, setFilters] = useState<Filters>({ assigneeType: 'me', status: 'open', q: '' }),
    [items, setItems] = useState<Conversation[]>([]),
    [meta, setMeta] = useState<Meta>({ mine: 0, unassigned: 0, all: 0 }),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(
    async (nextPage = 1) => {
      const base = {
        status: filters.status,
        inbox_id: filters.inboxId,
        label: filters.label,
        q: filters.q.trim() || undefined,
      };
      const [list, counts] = await Promise.all([
        http<Conversation[]>(
          `/conversations${query({ ...base, assignee_type: filters.assigneeType, page: nextPage })}`,
        ),
        http<Meta>(`/conversations/meta${query(base)}`),
      ]);
      setItems((current) => (nextPage === 1 ? list : [...current, ...list]));
      setHasMore(list.length === 25);
      setPage(nextPage);
      setMeta(counts);
      setError('');
    },
    [filters],
  );
  useEffect(() => {
    const handle = setTimeout(
      () => void load().catch((e: Error) => setError(e.message)),
      filters.q ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [load, filters.q]);
  useEffect(
    () =>
      realtime.subscribe(({ event }) => {
        if (!REFRESH_EVENTS.has(event)) return;
        clearTimeout(timer.current);
        // Bursts (message + activity + assignment) collapse into one refresh.
        timer.current = setTimeout(() => void load().catch(() => {}), 300);
      }),
    [realtime, load],
  );

  return (
    <div className={`inbox ${selected ? 'has-selection' : ''}`}>
      <ConversationList
        items={items}
        meta={meta}
        filters={filters}
        catalog={catalog}
        selected={selected}
        hasMore={hasMore}
        error={error}
        onFilters={(next) => setFilters((f) => ({ ...f, ...next }))}
        onSelect={onSelect}
        onMore={() => void load(page + 1)}
      />
      {selected ? (
        <ConversationView
          key={selected}
          displayId={selected}
          user={user}
          catalog={catalog}
          realtime={realtime}
          onBack={() => onSelect(null)}
        />
      ) : (
        <div className="conversation-empty">
          <MessagesSquare size={42} />
          <h2>Selecione uma conversa</h2>
          <p>As mensagens do WhatsApp chegam aqui em tempo real.</p>
        </div>
      )}
    </div>
  );
}
