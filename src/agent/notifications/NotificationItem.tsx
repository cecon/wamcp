import { AlarmClock, Check, Mail, MoreVertical, Trash2 } from 'lucide-react';
import { timeAgo } from '../api';
import type { AppNotification } from '../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { Dropdown, MenuItem } from '../ui/Overlay';
import { notificationText, SNOOZE_OPTIONS } from './notificationText';
import type { Notifications } from './useNotifications';

interface Props {
  notification: AppNotification;
  actions: Notifications;
  onOpen: (n: AppNotification) => void;
}

/** Chatwoot InboxCard: avatar, contact, sentence and time; the "⋮" menu reads, snoozes or deletes. */
export function NotificationItem({ notification: n, actions, onOpen }: Props) {
  const text = notificationText(n);
  return (
    <li className="group relative flex items-start border-b border-n-slate-3 hover:bg-n-alpha-1">
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-10 pl-4 text-left"
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
          <span className="block truncate text-sm text-n-slate-11">{text}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="text-xxs text-n-slate-11">{timeAgo(n.created_at)}</span>
          {!n.read_at && <span className="size-2 rounded-full bg-n-brand" aria-label="Não lida" />}
        </span>
      </button>
      <div className="absolute top-2 right-2 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
        <Dropdown
          className="w-60"
          trigger={({ toggle }) => (
            <Button
              color="slate"
              variant="ghost"
              size="xs"
              icon={MoreVertical}
              aria-label={`Ações: ${text}`}
              onClick={toggle}
            />
          )}
        >
          {(close) => {
            const run = (action: () => unknown) => () => {
              close();
              void action();
            };
            return (
              <>
                {n.read_at ? (
                  <MenuItem icon={Mail} label="Marcar como não lida" onClick={run(() => actions.unread(n))} />
                ) : (
                  <MenuItem icon={Check} label="Marcar como lida" onClick={run(() => actions.read(n))} />
                )}
                {SNOOZE_OPTIONS.map((o) => (
                  <MenuItem
                    key={o.label}
                    icon={AlarmClock}
                    label={o.label}
                    onClick={run(() => actions.snooze(n, o.until(new Date())))}
                  />
                ))}
                <MenuItem danger icon={Trash2} label="Excluir" onClick={run(() => actions.remove(n))} />
              </>
            );
          }}
        </Dropdown>
      </div>
    </li>
  );
}
