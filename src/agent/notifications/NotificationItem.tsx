import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { AlarmClock, Check, Mail, MoreVertical, Trash2 } from 'lucide-react';

import { timeAgo } from '../api';
import type { AppNotification } from '../types';
import { Avatar } from '../ui/Avatar';
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const run = (action: () => unknown) => () => {
    close();
    void action();
  };

  return (
    <Box
      component="li"
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        borderBottom: 1,
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onOpen(n)}
        sx={{
          display: 'flex',
          minWidth: 0,
          flex: 1,
          alignItems: 'flex-start',
          gap: 1.5,
          py: 1.5,
          pr: 5,
          pl: 2,
          border: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <Avatar name={n.contact_name || 'Contato'} size={32} />
        <Box component="span" sx={{ minWidth: 0, flex: 1, display: 'block' }}>
          <Typography
            component="span"
            variant="body2"
            noWrap
            sx={{ display: 'block', fontWeight: n.read_at ? 400 : 600 }}
          >
            {n.contact_name || 'Contato'}
          </Typography>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ display: 'block' }}
          >
            {text}
          </Typography>
        </Box>
        <Stack component="span" spacing={0.5} sx={{ alignItems: 'flex-end' }}>
          <Typography component="span" variant="caption" color="text.secondary">
            {timeAgo(n.created_at)}
          </Typography>
          {!n.read_at && (
            <Box
              component="span"
              aria-label="Não lida"
              sx={{ display: 'block', width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }}
            />
          )}
        </Stack>
      </Box>
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          opacity: 0.6,
          '&:hover, &:focus-within': { opacity: 1 },
        }}
      >
        <IconButton
          size="small"
          aria-label={`Ações: ${text}`}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <MoreVertical size={16} />
        </IconButton>
      </Box>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ paper: { sx: { width: 240 } } }}
      >
        {n.read_at ? (
          <MenuItem onClick={run(() => actions.unread(n))}>
            <ListItemIcon>
              <Mail size={16} />
            </ListItemIcon>
            <ListItemText>Marcar como não lida</ListItemText>
          </MenuItem>
        ) : (
          <MenuItem onClick={run(() => actions.read(n))}>
            <ListItemIcon>
              <Check size={16} />
            </ListItemIcon>
            <ListItemText>Marcar como lida</ListItemText>
          </MenuItem>
        )}
        {SNOOZE_OPTIONS.map((option) => (
          <MenuItem key={option.label} onClick={run(() => actions.snooze(n, option.until(new Date())))}>
            <ListItemIcon>
              <AlarmClock size={16} />
            </ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
          </MenuItem>
        ))}
        <MenuItem onClick={run(() => actions.remove(n))}>
          <ListItemIcon>
            <Trash2 size={16} />
          </ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>Excluir</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
