import { useCallback, useEffect, useState } from 'react';
import { connectRealtime, http, type Realtime } from './api';
import type { Availability, Catalog, User } from './types';
import { HOME, type Route } from './route';
import { Sidebar } from './sidebar/Sidebar';
import { ConversationsScreen } from './conversations/ConversationsScreen';
import { NotificationsPage } from './NotificationsPage';
import { ContactsPage } from './ContactsPage';
import { Reports } from './Reports';
import { SettingsRouter } from './settings/SettingsRouter';
import { useSavedViews } from './filters/useSavedViews';

interface Props {
  user: User;
  onUser: (user: User) => void;
  onLogout: () => void;
}

/** Chatwoot Dashboard.vue: sidebar + main router view. */
export function Workspace({ user, onUser, onLogout }: Props) {
  const [route, setRoute] = useState<Route>(HOME),
    [online, setOnline] = useState(false),
    [catalog, setCatalog] = useState<Catalog>({ inboxes: [], agents: [], teams: [], labels: [] }),
    [unread, setUnread] = useState(0);
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
      realtime.subscribe(({ event }) => {
        if (event === 'notification.created') setUnread((n) => n + 1);
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
  const isAdmin = user.role === 'administrator';

  return (
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
      />
      <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-n-surface-1">
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
        {route.page === 'notifications' && (
          <NotificationsPage
            realtime={realtime}
            onUnread={setUnread}
            onOpen={(displayId) => setRoute({ page: 'conversations', displayId })}
          />
        )}
        {route.page === 'contacts' && (
          <ContactsPage
            user={user}
            catalog={catalog}
            onOpenConversation={(displayId) => setRoute({ page: 'conversations', displayId })}
          />
        )}
        {route.page === 'reports' && isAdmin && <Reports catalog={catalog} />}
        {route.page === 'settings' && isAdmin && (
          <SettingsRouter
            route={route}
            user={user}
            catalog={catalog}
            onNavigate={setRoute}
            onChange={reloadCatalog}
          />
        )}
      </main>
    </div>
  );
}
