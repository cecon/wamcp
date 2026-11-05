// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { Realtime } from './api';
import { NotificationBulkActions, NotificationList } from './notifications/NotificationList';
import { useNotifications } from './notifications/useNotifications';
import C3Provider from './c3/C3Provider';

interface Props {
  realtime: Realtime;
  onUnread: (count: number) => void;
  onOpen: (displayId: number) => void;
}

/** Caixa de entrada ("Inbox") no C3Theme (lote 5): cabeçalho e moldura do pacote; a lista de notificações segue no app. */
export function NotificationsPage({ realtime, onUnread, onOpen }: Props) {
  const actions = useNotifications(realtime, onUnread);
  return (
    <C3Provider>
      <Box
        component="section"
        aria-label="Caixa de entrada"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: { xs: '100%', md: 400 },
          flexShrink: 0,
          bgcolor: 'background.paper',
          borderRight: { md: 1 },
          borderColor: 'divider',
        }}
      >
        <Box
          component="header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            px: 2,
            minHeight: 52,
          }}
        >
          <Typography variant="h5" component="h1">
            Caixa de entrada
          </Typography>
          <NotificationBulkActions actions={actions} />
        </Box>
        <NotificationList actions={actions} onOpen={onOpen} />
      </Box>
    </C3Provider>
  );
}
