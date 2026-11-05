// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { CheckCheck, Inbox, Trash2 } from 'lucide-react';

import type { AppNotification } from '../types';
import { NotificationItem } from './NotificationItem';
import type { Notifications } from './useNotifications';

/** "Marcar tudo como lido" and "Excluir todas" (Chatwoot InboxListHeader actions). */
export function NotificationBulkActions({ actions }: { actions: Notifications }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Button
        size="small"
        variant="outlined"
        startIcon={<CheckCheck size={14} />}
        onClick={() => void actions.readAll()}
      >
        Marcar tudo como lido
      </Button>
      <Button
        size="small"
        variant="outlined"
        startIcon={<Trash2 size={14} />}
        disabled={actions.items.length === 0}
        onClick={() => void actions.destroyAll()}
      >
        Excluir todas
      </Button>
    </Stack>
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
        <Alert severity="error" sx={{ mx: 2, my: 1 }}>
          {actions.error}
        </Alert>
      )}
      <Box
        component="ul"
        aria-label="Notificações"
        sx={{
          flex: 1,
          overflowY: 'auto',
          borderTop: 1,
          borderColor: 'divider',
          m: 0,
          p: 0,
          listStyle: 'none',
        }}
      >
        {actions.items.map((n) => (
          <NotificationItem key={n.id} notification={n} actions={actions} onOpen={open} />
        ))}
      </Box>
      {actions.loaded && actions.items.length === 0 && (
        <Stack
          sx={{
            flex: 1,
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            p: 4,
            textAlign: 'center',
            color: 'text.secondary',
          }}
        >
          <Inbox size={36} />
          <Typography variant="body2">Nenhuma notificação por aqui.</Typography>
        </Stack>
      )}
    </>
  );
}
