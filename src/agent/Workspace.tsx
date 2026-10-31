import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { connectRealtime, http, type Realtime } from './api';
import type { AppNotification, Availability, Catalog, User } from './types';
import { useRoute } from './navigation/useRoute';
import { canOpen } from './permissions';
import { NoAccess } from './ui/NoAccess';
import { Sidebar } from './sidebar/Sidebar';

// O shell do C3Theme (MUI/Emotion) entra em chunk separado para o shell atual continuar leve até a troca do padrão.
const C3Workspace = lazy(() => import('./shell/C3Workspace'));
// Páginas já migradas para o C3Theme carregam o chunk do MUI só quando abertas.
const NotificationsPage = lazy(() =>
  import('./NotificationsPage').then((module) => ({ default: module.NotificationsPage })),
);
const ProfilePage = lazy(() =>
  import('./profile/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
import { ConversationsScreen } from './conversations/ConversationsScreen';
import { ContactsPage } from './ContactsPage';
import { AgentChatScreen } from './agentChat/AgentChatScreen';
import { Reports } from './Reports';
import { SettingsRouter } from './settings/SettingsRouter';
import { useSavedViews } from './filters/useSavedViews';
import { NotificationBell } from './notifications/NotificationBell';
import { alertNotification } from './notifications/browserAlerts';
import { SearchPage } from './search/SearchPage';
import { ShortcutsModal } from './shortcuts/ShortcutsModal';
import { useHotkeys } from './shortcuts/hotkeys';
import { isDesktop } from './desktop/tauri';
import { UpdateNotice } from './desktop/UpdateNotice';

interface Props {
  user: User;
  onUser: (user: User) => void;
  onLogout: () => void;
}

/** Chatwoot Dashboard.vue: sidebar + main router view. */
export function Workspace({ user, onUser, onLogout }: Props) {
  const [route, setRoute] = useRoute(['c3shell']),
    [online, setOnline] = useState(false),
    [catalog, setCatalog] = useState<Catalog>({ inboxes: [], agents: [], teams: [], labels: [] }),
    [unread, setUnread] = useState(0),
    [shortcuts, setShortcuts] = useState(false);
  const [realtime] = useState<Realtime>(() => connectRealtime(setOnline));
  useEffect(() => () => realtime.close(), [realtime]);
  const { views, reload: reloadViews } = useSavedViews('conversation');

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

  // Troca do shell em curso (Fase 2): `?c3shell` monta o AppLayout do C3Theme; o padrão continua o sidebar atual
  // até a decisão de UX/testes da próxima rodada.
  const c3Shell = new URLSearchParams(window.location.search).has('c3shell');
  const bell = (
    <NotificationBell realtime={realtime} unread={unread} onUnread={setUnread} onOpen={openConversation} />
  );

  const content = (
    <>
      {route.page === 'conversations' && (
        <ConversationsScreen
          route={route}
          user={user}
          catalog={catalog}
          realtime={realtime}
          onNavigate={setRoute}
          views={views}
          onViewsChange={() => void reloadViews()}
        />
      )}
      {route.page === 'agent_chat' && (
        <AgentChatScreen
          agentId={route.agentId}
          realtime={realtime}
          onSelect={(agentId) => setRoute({ page: 'agent_chat', agentId })}
        />
      )}
      {route.page === 'notifications' && (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-n-slate-11">Carregando…</div>
          }
        >
          <NotificationsPage realtime={realtime} onUnread={setUnread} onOpen={openConversation} />
        </Suspense>
      )}
      {!allowed && <NoAccess />}
      {route.page === 'contacts' && allowed && (
        <ContactsPage
          user={user}
          catalog={catalog}
          realtime={realtime}
          onOpenConversation={openConversation}
          contactId={route.contactId}
        />
      )}
      {route.page === 'search' && (
        <SearchPage
          onOpenConversation={openConversation}
          onOpenContact={(contactId) => setRoute({ page: 'contacts', contactId })}
        />
      )}
      {route.page === 'reports' && allowed && <Reports catalog={catalog} section={route.section} />}
      {route.page === 'profile' && (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-n-slate-11">Carregando…</div>
          }
        >
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
      {c3Shell ? (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-n-slate-11">Carregando…</div>
          }
        >
          <C3Workspace
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
          </C3Workspace>
        </Suspense>
      ) : (
        <div className="flex h-full overflow-hidden text-n-slate-12">
          <Sidebar
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
          />
          <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-n-surface-1">{content}</main>
        </div>
      )}
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
      {isDesktop() && <UpdateNotice />}
    </>
  );
}
