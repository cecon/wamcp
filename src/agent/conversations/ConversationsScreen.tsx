import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { Realtime } from '../api';
import type { Catalog, CustomFilter, User } from '../types';
import type { Route } from '../route';
import { CONVERSATION_TYPE_LABEL } from '../labels';
import { cn } from '../ui/cn';
import { ChatList, type AssigneeType, type StatusFilter } from './ChatList';
import { ConversationBox } from './ConversationBox';
import { ConversationFilters } from './ConversationFilters';
import { useConversationList } from './useConversationList';

type ConversationsRoute = Extract<Route, { page: 'conversations' }>;

interface Props {
  route: ConversationsRoute;
  user: User;
  catalog: Catalog;
  realtime: Realtime;
  onNavigate: (route: Route) => void;
  /** Saved conversation views (sidebar folders) and a callback to reload them after changes. */
  views?: CustomFilter[];
  onViewsChange?: () => void;
}

function listTitle(route: ConversationsRoute, catalog: Catalog, view?: CustomFilter) {
  const { inboxId, teamId, label, q, conversationType, filters } = route;
  if (view) return view.name;
  if (filters) return 'Resultados do filtro';
  if (conversationType) return CONVERSATION_TYPE_LABEL[conversationType];
  if (inboxId) return catalog.inboxes.find((i) => i.id === inboxId)?.name || 'Caixa de entrada';
  if (teamId) return catalog.teams.find((t) => t.id === teamId)?.name || 'Time';
  if (label) return `#${label}`;
  return q ? `Busca: “${q}”` : 'Conversas';
}

/** Chatwoot ConversationView: ChatList | ConversationBox | ContactPanel. */
export function ConversationsScreen({
  route,
  user,
  catalog,
  realtime,
  onNavigate,
  views = [],
  onViewsChange = () => {},
}: Props) {
  const [status, setStatus] = useState<StatusFilter>('open'),
    [tab, setTab] = useState<AssigneeType>('me'),
    [sort, setSort] = useState('last_activity_at_desc');
  const list = useConversationList({ route, status, tab, sort, realtime });
  const { displayId } = route;
  const view = route.viewId ? views.find((v) => v.id === route.viewId) : undefined;
  const select = (id: number | undefined) => onNavigate({ ...route, displayId: id });

  return (
    <div className="flex h-full w-full">
      <div className={cn('h-full w-full md:w-auto', displayId ? 'hidden md:block' : false)}>
        <ChatList
          title={listTitle(route, catalog, view)}
          items={list.items}
          meta={list.meta}
          status={status}
          tab={tab}
          sort={sort}
          filtering={Boolean(route.filters)}
          toolbar={
            <ConversationFilters
              route={route}
              catalog={catalog}
              view={view}
              onNavigate={onNavigate}
              onViewsChange={onViewsChange}
            />
          }
          catalog={catalog}
          selected={displayId}
          hasMore={list.hasMore}
          error={list.error}
          onStatus={setStatus}
          onTab={setTab}
          onSort={setSort}
          onSelect={select}
          onMore={list.more}
          onReload={list.reload}
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
          onDeleted={() => {
            list.reload();
            select(undefined);
          }}
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
