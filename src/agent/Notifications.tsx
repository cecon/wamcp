import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, X } from 'lucide-react';
import { formatTime, http, type Realtime } from './api';
import type { AppNotification } from './types';

const TEXT: Record<string, (n: AppNotification) => string> = {
  conversation_assignment: (n) => `${n.actor_name || 'Sistema'} atribuiu a você a conversa #${n.display_id}`,
  assigned_conversation_new_message: (n) =>
    `Nova mensagem de ${n.contact_name || 'contato'} em #${n.display_id}`,
  conversation_creation: (n) => `Nova conversa #${n.display_id} de ${n.contact_name || 'contato'}`,
};

interface Props {
  realtime: Realtime;
  onUnread: (count: number) => void;
  onClose: () => void;
  onOpen: (displayId: number) => void;
}

export function Notifications({ realtime, onUnread, onClose, onOpen }: Props) {
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
    <section className="notifications" aria-label="Notificações">
      <header>
        <h2>Notificações</h2>
        <button
          className="btn ghost small"
          onClick={() => void http('/notifications/read_all', 'POST').then(load)}
          title="Marcar todas como lidas"
        >
          <CheckCheck size={15} /> Ler todas
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          <X size={17} />
        </button>
      </header>
      {items.length === 0 && <p className="muted pad">Nenhuma notificação.</p>}
      <ul>
        {items.map((n) => (
          <li key={n.id} className={n.read_at ? '' : 'unread'}>
            <button
              onClick={() => {
                if (!n.read_at)
                  void http<{ unread: number }>(`/notifications/${n.id}`, 'PATCH', {}).then((r) =>
                    onUnread(r.unread),
                  );
                if (n.display_id) onOpen(n.display_id);
              }}
            >
              <span>{(TEXT[n.notification_type] || (() => n.notification_type))(n)}</span>
              <small>{formatTime(n.created_at)}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
