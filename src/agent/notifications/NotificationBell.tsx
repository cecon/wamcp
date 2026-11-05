import { useEffect, useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Bell, X } from 'lucide-react';

import type { Realtime } from '../api';
import C3Provider from '../c3/C3Provider';
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
    const outside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target as Node)) return;
      // The item menu is portaled to <body>; clicking it must not close the panel under it.
      if (target.closest?.('[role="menu"]')) return;
      setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <Box ref={ref} sx={{ position: 'relative', ml: 'auto' }}>
      <IconButton
        size="small"
        aria-label={unread ? `Notificações (${unread} não lidas)` : 'Notificações'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        sx={{ position: 'relative', color: 'var(--color-n-slate-11)' }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <Box
            component="span"
            aria-hidden
            sx={{
              position: 'absolute',
              top: -4,
              right: -4,
              display: 'flex',
              height: 16,
              minWidth: 16,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '999px',
              bgcolor: 'var(--color-n-ruby-9)',
              px: 0.5,
              fontSize: 10,
              lineHeight: 1,
              fontWeight: 500,
              color: '#fff',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </Box>
        )}
      </IconButton>
      {open && (
        <C3Provider>
          <NotificationsPanel
            realtime={realtime}
            onUnread={onUnread}
            onClose={() => setOpen(false)}
            onOpen={(displayId) => {
              setOpen(false);
              onOpen(displayId);
            }}
          />
        </C3Provider>
      )}
    </Box>
  );
}

interface PanelProps {
  realtime: Realtime;
  onUnread: (count: number) => void;
  onOpen: (displayId: number) => void;
  onClose: () => void;
}

function NotificationsPanel({ realtime, onUnread, onOpen, onClose }: PanelProps) {
  const actions = useNotifications(realtime, onUnread);
  return (
    <Paper
      role="dialog"
      aria-label="Painel de notificações"
      elevation={8}
      sx={{
        position: 'fixed',
        top: 8,
        left: 208,
        zIndex: 40,
        display: 'flex',
        maxHeight: 'min(36rem, calc(100vh - 1rem))',
        width: 416,
        maxWidth: 'calc(100vw - 14rem)',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 1.5,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        component="header"
        direction="row"
        sx={{
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2,
          py: 1.5,
        }}
      >
        <Typography variant="subtitle2" component="h2">
          Notificações
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <NotificationBulkActions actions={actions} />
          <IconButton size="small" aria-label="Fechar notificações" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </Stack>
      </Stack>
      <NotificationList actions={actions} onOpen={onOpen} />
    </Paper>
  );
}
