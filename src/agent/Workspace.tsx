import { useCallback, useEffect, useState, lazy, Suspense } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { connectRealtime, http, type Realtime } from './api';
import type { AppNotification, Availability, Catalog, User } from './types';
import { useRoute } from './navigation/useRoute';
import { canOpen } from './permissions';
import { NoAccess } from './ui/NoAccess';

// O shell do C3Theme (MUI/Emotion) entra em chunk separado para o shell atual continuar leve até a troca do padrão.
const C3Workspace = lazy(() => import('./shell/C3Workspace'));
// Shell antigo atrÃ¡s de ?shelllegacy (rollback/comparaÃ§Ã£o): chunk lazy para nÃ£o pesar no padrÃ£o.
const LegacyWorkspace = lazy(() => import('./shell/LegacyWorkspace'));
// Páginas já migradas para o C3Theme carregam o chunk do MUI só quando abertas.
const NotificationsPage = lazy(() =>
  import('./NotificationsPage').then((module) => ({ default: module.NotificationsPage })),
);
const ProfilePage = lazy(() =>
  import('./profile/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const SearchPage = lazy(() =>
  import('./search/SearchPage').then((module) => ({ default: module.SearchPage })),
);
const ContactsPage = lazy(() =>
  import('./ContactsPage').then((module) => ({ default: module.ContactsPage })),
);
const Reports = lazy(() => import('./Reports').then((module) => ({ default: module.Reports })));
const ConversationsScreen = lazy(() =>
  import('./conversations/ConversationsScreen').then((module) => ({ default: module.ConversationsScreen })),
);
const AgentRunsPage = lazy(() =>
  import('./agentRuns/AgentRunsPage').then((module) => ({ default: module.AgentRunsPage })),
);
const AgentChatScreen = lazy(() =>
  import('./agentChat/AgentChatScreen').then((module) => ({ default: module.AgentChatScreen })),
);
import { SettingsRouter } from './settings/SettingsRouter';
import { useSavedViews } from './filters/useSavedViews';
import { useAgentRuns } from './agentRuns/useAgentRuns';
import { NotificationBell } from './notifications/NotificationBell';
import { alertNotification } from './notifications/browserAlerts';
import { ShortcutsModal } from './shortcuts/ShortcutsModal';
import { useHotkeys } from './shortcuts/hotkeys';
import { isDesktop } from './desktop/tauri';
import { UpdateNotice } from './desktop/UpdateNotice';

/** Fallback das páginas/chunks carregados sob demanda. */
const Loading = () => (
  <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
    <Typography variant="body2" color="text.secondary">
      Carregando…
    </Typography>
  </Box>
);

interface Props {
  user: User;
  onUser: (user: User) => void;
  onLogout: () => void;
}

/** Chatwoot Dashboard.vue: sidebar + main router view. */
export function Workspace({ user, onUser, onLogout }: Props) {
  const [route, setRoute] = useRoute(['c3shell', 'shelllegacy']),
    [online, setOnline] = useState(false),
    [catalog, setCatalog] = useState<Catalog>({ inboxes: [], agents: [], teams: [], labels: [] }),
    [unread, setUnread] = useState(0),
    [shortcuts, setShortcuts] = useState(false);
  const [realtime] = useState<Realtime>(() => connectRealtime(setOnline));
  useEffect(() => () => realtime.close(), [realtime]);
  const { views, reload: reloadViews } = useSavedViews('conversation');
  const agentRuns = useAgentRuns(realtime);

  const reloadCatalog = useCallback(async () => {
    const [inboxes, agents, teams, labels] = await Promise.all([
      http<Catalog['inboxes']>('/inboxes'),
      http<Catalog['agents']>('/agents'),
      http<Catalog['teams']>('/teams'),
      http<Catalog['labels']>('/labels'),
    ]);
    setCatalog({ inboxes, agents, teams, labels });
  }, []);
  const reloadUnread = useCallback(
    () =>
      http<{ unread: number }>('/notifications/unread_count')
        .then((r) => setUnread(r.unread))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    const initial = setTimeout(() => {
      void reloadCatalog().catch(() => {});
      void reloadUnread();
    }, 0);
    return () => clearTimeout(initial);
  }, [reloadCatalog, reloadUnread]);
  useEffect(
    () =>
      realtime.subscribe(({ event, data }) => {
        if (event === 'notification.created') {
          setUnread((n) => n + 1);
          alertNotification(data as unknown as AppNotification);
        }
        if (event === 'presence.update') void reloadCatalog().catch(() => {});
      }),
    [realtime, reloadCatalog],
  );

  function setAvailability(availability: Availability) {
    // Presence is best effort: the menu keeps the previous state if the server rejects the change.
    http<User>('/profile', 'PATCH', { availability })
      .then((updated) => onUser({ ...user, ...updated }))
      .catch(() => {});
  }
  async function logout() {
    await http('/auth/logout', 'POST').catch(() => {});
    realtime.close();
    onLogout();
  }
  const allowed = canOpen(user, route);
  const openConversation = (displayId: number) => setRoute({ page: 'conversations', displayId });
  useHotkeys([
    { keys: '?', run: () => setShortcuts((open) => !open) },
    { keys: 'mod+k', run: () => setRoute({ page: 'search' }) },
  ]);

  // Padrão: AppLayout do C3Theme (header e menu do pacote). `?shelllegacy` monta o shell antigo para rollback.
  const legacyShell = new URLSearchParams(window.location.search).has('shelllegacy');
  const bell = (
    <NotificationBell realtime={realtime} unread={unread} onUnread={setUnread} onOpen={openConversation} />
  );

  const content = (
    <>
      {route.page === 'conversations' && (
        <Suspense fallback={<Loading />}>
          <ConversationsScreen
            route={route}
            user={user}
            catalog={catalog}
            realtime={realtime}
            onNavigate={setRoute}
            views={views}
            onViewsChange={() => void reloadViews()}
          />
        </Suspense>
      )}
      {route.page === 'agent_chat' && (
        <Suspense fallback={<Loading />}>
          <AgentChatScreen
            agentId={route.agentId}
            realtime={realtime}
            onSelect={(agentId) => setRoute({ page: 'agent_chat', agentId })}
          />
        </Suspense>
      )}
      {route.page === 'agent_runs' && (
        <Suspense fallback={<Loading />}>
          <AgentRunsPage
            runs={agentRuns.runs}
            error={agentRuns.error}
            onNavigate={setRoute}
            onChanged={agentRuns.reload}
          />
        </Suspense>
      )}
      {route.page === 'notifications' && (
        <Suspense fallback={<Loading />}>
          <NotificationsPage realtime={realtime} onUnread={setUnread} onOpen={openConversation} />
        </Suspense>
      )}
      {!allowed && <NoAccess />}
      {route.page === 'contacts' && allowed && (
        <Suspense fallback={<Loading />}>
          <ContactsPage
            user={user}
            catalog={catalog}
            realtime={realtime}
            onOpenConversation={openConversation}
            contactId={route.contactId}
          />
        </Suspense>
      )}
      {route.page === 'search' && (
        <Suspense fallback={<Loading />}>
          <SearchPage
            onOpenConversation={openConversation}
            onOpenContact={(contactId) => setRoute({ page: 'contacts', contactId })}
          />
        </Suspense>
      )}
      {route.page === 'reports' && allowed && (
        <Suspense fallback={<Loading />}>
          <Reports catalog={catalog} section={route.section} />
        </Suspense>
      )}
      {route.page === 'profile' && (
        <Suspense fallback={<Loading />}>
          <ProfilePage user={user} />
        </Suspense>
      )}
      {route.page === 'settings' && allowed && (
        <SettingsRouter
          route={route}
          user={user}
          catalog={catalog}
          onNavigate={setRoute}
          onChange={reloadCatalog}
        />
      )}
    </>
  );

  return (
    <>
      <Suspense fallback={<Loading />}>
        {legacyShell ? (
          <LegacyWorkspace
            user={user}
            catalog={catalog}
            views={views}
            route={route}
            unread={unread}
            online={online}
            onNavigate={setRoute}
            onAvailability={setAvailability}
            onLogout={() => void logout()}
            onShortcuts={() => setShortcuts(true)}
            bell={bell}
          >
            {content}
          </LegacyWorkspace>
        ) : (
          <C3Workspace
            user={user}
            catalog={catalog}
            views={views}
            route={route}
            unread={unread}
            running={agentRuns.runs.length}
            online={online}
            onNavigate={setRoute}
            onAvailability={setAvailability}
            onLogout={() => void logout()}
            onShortcuts={() => setShortcuts(true)}
            bell={bell}
          >
            {content}
          </C3Workspace>
        )}
      </Suspense>
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
      {isDesktop() && <UpdateNotice />}
    </>
  );
}
