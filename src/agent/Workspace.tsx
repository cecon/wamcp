import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookUser, LogOut, MessagesSquare, Settings2 } from 'lucide-react';
import { connectRealtime, http, initials, type Realtime } from './api';
import type { Availability, Catalog, User } from './types';
import { Inbox } from './inbox/Inbox';
import { Contacts } from './Contacts';
import { SettingsPage } from './settings/SettingsPage';
import { Notifications } from './Notifications';

const AVAILABILITY: Record<Availability, string> = { online: 'Online', busy: 'Ocupado', offline: 'Offline' };
type Page = 'inbox' | 'contacts' | 'settings';

interface Props {
  user: User;
  onUser: (user: User) => void;
  onLogout: () => void;
}

export function Workspace({ user, onUser, onLogout }: Props) {
  const [page, setPage] = useState<Page>('inbox'),
    [online, setOnline] = useState(false),
    [catalog, setCatalog] = useState<Catalog>({ inboxes: [], agents: [], teams: [], labels: [] }),
    [unread, setUnread] = useState(0),
    [showNotifications, setShowNotifications] = useState(false),
    [openConversation, setOpenConversation] = useState<number | null>(null);
  const [realtime] = useState<Realtime>(() => connectRealtime(setOnline));
  useEffect(() => () => realtime.close(), [realtime]);

  const reloadCatalog = useCallback(async () => {
    const [inboxes, agents, teams, labels] = await Promise.all([
      http<Catalog['inboxes']>('/inboxes'),
      http<Catalog['agents']>('/agents'),
      http<Catalog['teams']>('/teams'),
      http<Catalog['labels']>('/labels'),
    ]);
    setCatalog({ inboxes, agents, teams, labels });
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      void reloadCatalog().catch(() => {});
      void http<{ unread: number }>('/notifications/unread_count')
        .then((r) => setUnread(r.unread))
        .catch(() => {});
    }, 0);
    return () => clearTimeout(initial);
  }, [reloadCatalog]);
  useEffect(
    () =>
      realtime.subscribe(({ event }) => {
        if (event === 'notification.created') setUnread((n) => n + 1);
        if (event === 'presence.update') void reloadCatalog().catch(() => {});
      }),
    [realtime, reloadCatalog],
  );

  const isAdmin = user.role === 'administrator';
  const nav = useMemo(
    () =>
      [
        { id: 'inbox', label: 'Conversas', icon: MessagesSquare },
        { id: 'contacts', label: 'Contatos', icon: BookUser },
        ...(isAdmin ? [{ id: 'settings', label: 'Configurações', icon: Settings2 }] : []),
      ] as { id: Page; label: string; icon: typeof Bell }[],
    [isAdmin],
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

  return (
    <div className="agent-app">
      <aside className="rail">
        <div className="rail-logo" title="WA MCP · Atendimento">
          WA
        </div>
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={page === id ? 'active' : ''}
            title={label}
            aria-label={label}
            onClick={() => setPage(id)}
          >
            <Icon size={20} />
          </button>
        ))}
        <button
          className={`bell ${showNotifications ? 'active' : ''}`}
          title="Notificações"
          aria-label="Notificações"
          onClick={() => setShowNotifications((v) => !v)}
        >
          <Bell size={20} />
          {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <div className="rail-bottom">
          <span
            className={`live ${online ? 'on' : ''}`}
            title={online ? 'Tempo real conectado' : 'Reconectando'}
          />
          <div className="me" title={`${user.name} · ${AVAILABILITY[user.availability]}`}>
            <span className="avatar">{initials(user.name)}</span>
            <i className={`presence ${user.availability}`} />
            <div className="me-menu">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
              {(Object.keys(AVAILABILITY) as Availability[]).map((a) => (
                <button
                  key={a}
                  className={user.availability === a ? 'active' : ''}
                  onClick={() => setAvailability(a)}
                >
                  <i className={`presence ${a}`} />
                  {AVAILABILITY[a]}
                </button>
              ))}
              <button onClick={() => void logout()}>
                <LogOut size={15} /> Sair
              </button>
            </div>
          </div>
        </div>
      </aside>
      {showNotifications && (
        <Notifications
          realtime={realtime}
          onUnread={setUnread}
          onClose={() => setShowNotifications(false)}
          onOpen={(displayId) => {
            setPage('inbox');
            setOpenConversation(displayId);
            setShowNotifications(false);
          }}
        />
      )}
      <main className="agent-main">
        {page === 'inbox' && (
          <Inbox
            user={user}
            catalog={catalog}
            realtime={realtime}
            selected={openConversation}
            onSelect={setOpenConversation}
          />
        )}
        {page === 'contacts' && (
          <Contacts
            onOpenConversation={(displayId) => {
              setPage('inbox');
              setOpenConversation(displayId);
            }}
          />
        )}
        {page === 'settings' && isAdmin && (
          <SettingsPage user={user} catalog={catalog} onChange={reloadCatalog} />
        )}
      </main>
    </div>
  );
}
