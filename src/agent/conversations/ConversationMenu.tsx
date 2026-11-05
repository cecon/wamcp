import { useState } from 'react';

// material-ui
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';

// third-party
import { Bell, BellOff, Download, EllipsisVertical, MailOpen, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { download, http } from '../api';
import type { Conversation } from '../types';
import C3Provider from '../c3/C3Provider';

interface Props {
  conversation: Conversation;
  isAdmin: boolean;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
  /** Leaves the conversation (after "mark as unread" and deletion, like Chatwoot). */
  onLeave: () => void;
  onDeleted: () => void;
}

/** Menu “mais ações” da conversa no C3Theme (lote 20): não lida, silenciar, transcrição e excluir. */
export function ConversationMenu({ conversation: c, isAdmin, onChange, onError, onLeave, onDeleted }: Props) {
  const [confirm, setConfirm] = useState(false),
    [anchor, setAnchor] = useState<HTMLElement | null>(null),
    [deleteError, setDeleteError] = useState(''),
    [deleting, setDeleting] = useState(false);
  const path = `/conversations/${c.display_id}`;
  const run = (action: () => Promise<unknown>) => void action().catch((e: Error) => onError(e.message));
  const close = () => setAnchor(null);
  const items = [
    {
      icon: MailOpen,
      label: 'Marcar como não lida',
      action: () =>
        run(async () => {
          await http(`${path}/unread`, 'POST');
          onLeave();
        }),
    },
    c.muted
      ? {
          icon: Bell,
          label: 'Reativar notificações',
          action: () => run(async () => onChange(await http<Conversation>(`${path}/unmute`, 'POST'))),
        }
      : {
          icon: BellOff,
          label: 'Silenciar conversa',
          action: () => run(async () => onChange(await http<Conversation>(`${path}/mute`, 'POST'))),
        },
    {
      icon: Download,
      label: 'Baixar transcrição',
      action: () => run(() => download(`${path}/transcript`, `conversa-${c.display_id}.txt`)),
    },
  ];

  return (
    <>
      <IconButton size="small" aria-label="Mais ações" onClick={(event) => setAnchor(event.currentTarget)}>
        <EllipsisVertical size={16} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ paper: { sx: { width: 240 } } }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              close();
              item.action();
            }}
          >
            <ListItemIcon>
              <item.icon size={16} />
            </ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
        {isAdmin && (
          <MenuItem
            onClick={() => {
              close();
              setConfirm(true);
            }}
          >
            <ListItemIcon>
              <Trash2 size={16} />
            </ListItemIcon>
            <ListItemText sx={{ color: 'error.main' }}>Excluir conversa</ListItemText>
          </MenuItem>
        )}
      </Menu>
      {confirm && (
        <C3Provider>
          <ActionDialog
            open
            title="Excluir conversa"
            description={`A conversa #${c.display_id} e todas as mensagens dela serão excluídas permanentemente.`}
            confirmLabel="Excluir"
            backLabel="Cancelar"
            tone="danger"
            loading={deleting}
            error={deleteError}
            onClose={() => {
              setConfirm(false);
              setDeleteError('');
            }}
            onConfirm={async () => {
              setDeleting(true);
              setDeleteError('');
              try {
                await http(path, 'DELETE');
                setConfirm(false);
                onDeleted();
              } catch (e) {
                setDeleteError((e as Error).message);
              } finally {
                setDeleting(false);
              }
            }}
          />
        </C3Provider>
      )}
    </>
  );
}
