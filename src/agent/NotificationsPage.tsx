import type { Realtime } from './api';
import { NotificationBulkActions, NotificationList } from './notifications/NotificationList';
import { useNotifications } from './notifications/useNotifications';

interface Props {
  realtime: Realtime;
  onUnread: (count: number) => void;
  onOpen: (displayId: number) => void;
}

/** Chatwoot "Inbox" view: the agent's notification feed, newest first. */
export function NotificationsPage({ realtime, onUnread, onOpen }: Props) {
  const actions = useNotifications(realtime, onUnread);
  return (
    <section
      aria-label="Caixa de entrada"
      className="flex h-full w-full flex-col bg-n-surface-1 md:w-[400px] md:border-r md:border-n-weak"
    >
      <header className="flex h-[3.25rem] items-center justify-between gap-2 px-4">
        <h1 className="text-base font-medium text-n-slate-12">Caixa de entrada</h1>
        <NotificationBulkActions actions={actions} />
      </header>
      <NotificationList actions={actions} onOpen={onOpen} />
    </section>
  );
}
