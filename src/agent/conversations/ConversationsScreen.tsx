import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

// third-party
import { MessageCircle, SquarePen } from 'lucide-react';

import type { Realtime } from '../api';
import type { Catalog, CustomFilter, User } from '../types';
import type { Route } from '../route';
import { CONVERSATION_TYPE_LABEL } from '../labels';
import { NewChatModal } from './NewChatModal';
import { ChatList, type AssigneeType, type StatusFilter } from './ChatList';
import { ConversationBox } from './ConversationBox';
import { ConversationFilters } from './ConversationFilters';
import { useConversationList } from './useConversationList';
import { useHotkeys } from '../shortcuts/hotkeys';

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
    [sort, setSort] = useState('last_activity_at_desc'),
    [starting, setStarting] = useState(false);
  const list = useConversationList({ route, status, tab, sort, realtime });
  const { displayId } = route;
  const view = route.viewId ? views.find((v) => v.id === route.viewId) : undefined;
  const select = (id: number | undefined) => onNavigate({ ...route, displayId: id });
  /** Alt+J / Alt+K: next / previous conversation of the list (Chatwoot). */
  const step = (delta: number) => {
    const index = list.items.findIndex((c) => c.display_id === displayId);
    const next = list.items[index < 0 ? 0 : index + delta];
    if (next) select(next.display_id);
  };
  useHotkeys([
    { keys: 'alt+j', run: () => step(1) },
    { keys: 'alt+k', run: () => step(-1) },
  ]);

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%' }}>
      <Box
        sx={{
          height: '100%',
          width: { xs: '100%', md: 'auto' },
          display: displayId ? { xs: 'none', md: 'block' } : 'block',
        }}
      >
        <ChatList
          title={listTitle(route, catalog, view)}
          items={list.items}
          meta={list.meta}
          status={status}
          tab={tab}
          sort={sort}
          filtering={Boolean(route.filters)}
          toolbar={
            <>
              <IconButton
                size="small"
                aria-label="Nova conversa"
                title="Nova conversa"
                onClick={() => setStarting(true)}
              >
                <SquarePen size={16} />
              </IconButton>
              <ConversationFilters
                route={route}
                catalog={catalog}
                view={view}
                onNavigate={onNavigate}
                onViewsChange={onViewsChange}
              />
            </>
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
      </Box>
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
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            flex: 1,
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'var(--color-n-surface-1)',
            color: 'text.secondary',
          }}
        >
          <MessageCircle size={40} />
          <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary' }}>
            Selecione uma conversa
          </Typography>
          <Typography variant="body2">As mensagens do WhatsApp chegam aqui em tempo real.</Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<SquarePen size={16} />}
            sx={{ mt: 1 }}
            onClick={() => setStarting(true)}
          >
            Nova conversa
          </Button>
        </Box>
      )}
      {starting && (
        <NewChatModal
          inboxes={catalog.inboxes}
          onClose={() => setStarting(false)}
          onAgent={(agentId) => onNavigate({ page: 'agent_chat', agentId })}
          onConversation={(id) => {
            setStarting(false);
            list.reload();
            onNavigate({ page: 'conversations', displayId: id });
          }}
        />
      )}
    </Box>
  );
}
