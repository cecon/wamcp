import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Inbox } from 'lucide-react';
import { http, timeAgo, type Realtime } from './api';
import type { AppNotification } from './types';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { cn } from './ui/cn';

const TEXT: Record<string, (n: AppNotification) => string> = {
  conversation_assignment: (n) => `${n.actor_name || 'Sistema'} atribuiu a você a conversa #${n.display_id}`,
  assigned_conversation_new_message: (n) => `Nova mensagem em #${n.display_id}`,
  conversation_creation: (n) => `Nova conversa #${n.display_id}`,
};

interface Props {
  realtime: Realtime;
  onUnread: (count: number) => void;
  onOpen: (displayId: number) => void;
}

/** Chatwoot "Inbox" view: the agent's notification feed, newest first. */
export function NotificationsPage({ realtime, onUnread, onOpen }: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const load = useCallback(async () => {
    const result = await http<{ items: AppNotification[]; unread: number }>('/notifications');
    setItems(result.items);
    onUnread(result.unread);
  }, [onUnread]);
  useEffect(() => {
    const initial = setTimeout(() => void load().catch(() => {}), 0);
    const unsubscribe = realtime.subscribe(({ event }) => {
      if (event === 'notification.created') void load().catch(() => {});
    });
    return () => {
      clearTimeout(initial);
      unsubscribe();
    };
  }, [load, realtime]);

  return (
    <section
      aria-label="Caixa de entrada"
      className="flex h-full w-full flex-col bg-n-surface-1 md:w-[400px] md:border-r md:border-n-weak"
    >
      <header className="flex h-[3.25rem] items-center justify-between px-4">
        <h1 className="text-base font-medium text-n-slate-12">Caixa de entrada</h1>
        <Button
          color="slate"
          variant="faded"
          size="xs"
          icon={CheckCheck}
          label="Marcar tudo como lido"
          onClick={() => void http('/notifications/read_all', 'POST').then(load)}
        />
      </header>
      <ul className="flex-1 overflow-y-auto border-t border-n-weak">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.read_at)
                  void http<{ unread: number }>(`/notifications/${n.id}`, 'PATCH', {}).then((r) =>
                    onUnread(r.unread),
                  );
                if (n.display_id) onOpen(n.display_id);
              }}
              className="flex w-full items-start gap-3 border-b border-n-slate-3 px-4 py-3 text-left hover:bg-n-alpha-1"
            >
              <Avatar name={n.contact_name || 'Contato'} size={32} />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm',
                    n.read_at ? 'text-n-slate-11' : 'font-medium text-n-slate-12',
                  )}
                >
                  {n.contact_name || 'Contato'}
                </span>
                <span className="block truncate text-sm text-n-slate-11">
                  {(TEXT[n.notification_type] || (() => n.notification_type))(n)}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="text-xxs text-n-slate-11">{timeAgo(n.created_at)}</span>
                {!n.read_at && <span className="size-2 rounded-full bg-n-brand" aria-label="Não lida" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-n-slate-11">
          <Inbox size={36} className="text-n-slate-8" />
          <p className="text-sm">Nenhuma notificação por aqui.</p>
        </div>
      )}
    </section>
  );
}
