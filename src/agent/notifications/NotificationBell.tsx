import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { Realtime } from '../api';
import { Button } from '../ui/Button';
import { NotificationBulkActions, NotificationList } from './NotificationList';
import { useNotifications } from './useNotifications';

interface Props {
  realtime: Realtime;
  unread: number;
  onUnread: (count: number) => void;
  onOpen: (displayId: number) => void;
}

/** Chatwoot notification bell: unread badge and a floating panel with the latest notifications. */
export function NotificationBell({ realtime, unread, onUnread, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        aria-label={unread ? `Notificações (${unread} não lidas)` : 'Notificações'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-7 place-content-center rounded-lg text-n-slate-11 hover:bg-n-alpha-2"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-n-ruby-9 px-1 text-[0.625rem] leading-none font-medium text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <Panel
          realtime={realtime}
          onUnread={onUnread}
          onClose={() => setOpen(false)}
          onOpen={(displayId) => {
            setOpen(false);
            onOpen(displayId);
          }}
        />
      )}
    </div>
  );
}

interface PanelProps {
  realtime: Realtime;
  onUnread: (count: number) => void;
  onOpen: (displayId: number) => void;
  onClose: () => void;
}

function Panel({ realtime, onUnread, onOpen, onClose }: PanelProps) {
  const actions = useNotifications(realtime, onUnread);
  return (
    <div
      role="dialog"
      aria-label="Painel de notificações"
      className="fixed top-2 left-[13rem] z-40 flex max-h-[min(36rem,calc(100vh-1rem))] w-[26rem] max-w-[calc(100vw-14rem)] flex-col overflow-hidden rounded-xl border border-n-weak bg-n-alpha-3 shadow-lg backdrop-blur-[100px]"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-medium text-n-slate-12">Notificações</h2>
        <div className="flex items-center gap-1">
          <NotificationBulkActions actions={actions} />
          <Button
            color="slate"
            variant="ghost"
            size="xs"
            icon={X}
            aria-label="Fechar notificações"
            onClick={onClose}
          />
        </div>
      </header>
      <NotificationList actions={actions} onOpen={onOpen} />
    </div>
  );
}
