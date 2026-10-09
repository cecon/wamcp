import { CheckCheck, Inbox, Trash2 } from 'lucide-react';
import type { AppNotification } from '../types';
import { Button } from '../ui/Button';
import { NotificationItem } from './NotificationItem';
import type { Notifications } from './useNotifications';

/** "Marcar tudo como lido" and "Excluir todas" (Chatwoot InboxListHeader actions). */
export function NotificationBulkActions({ actions }: { actions: Notifications }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        color="slate"
        variant="faded"
        size="xs"
        icon={CheckCheck}
        label="Marcar tudo como lido"
        onClick={() => void actions.readAll()}
      />
      <Button
        color="slate"
        variant="faded"
        size="xs"
        icon={Trash2}
        label="Excluir todas"
        disabled={actions.items.length === 0}
        onClick={() => void actions.destroyAll()}
      />
    </div>
  );
}

interface Props {
  actions: Notifications;
  /** Opens the notification's conversation (it is marked as read first). */
  onOpen: (displayId: number) => void;
}

/** The notification feed, newest first, with the empty state. */
export function NotificationList({ actions, onOpen }: Props) {
  const open = (n: AppNotification) => {
    void actions.read(n);
    if (n.display_id) onOpen(n.display_id);
  };
  return (
    <>
      {actions.error && (
        <p role="alert" className="px-4 py-2 text-sm text-n-ruby-11">
          {actions.error}
        </p>
      )}
      <ul aria-label="Notificações" className="flex-1 overflow-y-auto border-t border-n-weak">
        {actions.items.map((n) => (
          <NotificationItem key={n.id} notification={n} actions={actions} onOpen={open} />
        ))}
      </ul>
      {actions.loaded && actions.items.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-n-slate-11">
          <Inbox size={36} className="text-n-slate-8" />
          <p className="text-sm">Nenhuma notificação por aqui.</p>
        </div>
      )}
    </>
  );
}
