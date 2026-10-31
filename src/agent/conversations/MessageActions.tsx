import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';

// third-party
import { Copy, Reply, SmilePlus, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import C3Provider from '../c3/C3Provider';
import type { Message } from '../types';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface MessageHandlers {
  onReply: (message: Message) => void;
  /** Empty emoji removes the agent's reaction. */
  onReact: (message: Message, emoji: string) => void;
  onDelete: (message: Message) => void;
  onRetry: (message: Message) => void;
  onJump: (id: number) => void;
}

interface Props {
  message: Message;
  outgoing: boolean;
  myReaction?: string;
  handlers: MessageHandlers;
}

/** Ações da mensagem no C3Theme (lote 19): toolbar de responder/reagir/copiar/apagar e o diálogo de apagar. */
export function MessageActions({ message: m, outgoing, myReaction, handlers }: Props) {
  const [confirm, setConfirm] = useState(false),
    [copied, setCopied] = useState(false),
    [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const deleted = Boolean(m.content_attributes.deleted);
  if (deleted) return null;
  const copy = () =>
    void navigator.clipboard
      ?.writeText(m.content || '')
      .then(() => setCopied(true))
      .catch(() => {});
  const iconSx = { p: 0.5, borderRadius: 1, color: 'text.secondary' };
  return (
    <>
      <Box
        role="toolbar"
        aria-label="Ações da mensagem"
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          alignSelf: 'center',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          p: 0.25,
          boxShadow: 1,
          mr: outgoing ? 0.5 : 0,
          ml: outgoing ? 0 : 0.5,
        }}
      >
        <IconButton
          size="small"
          aria-label="Responder"
          title="Responder"
          sx={iconSx}
          onClick={() => handlers.onReply(m)}
        >
          <Reply size={15} />
        </IconButton>
        {!m.private && (
          <>
            <IconButton
              size="small"
              aria-label="Reagir"
              title="Reagir"
              sx={iconSx}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              <SmilePlus size={15} />
            </IconButton>
            <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
              {QUICK_REACTIONS.map((emoji) => (
                <MenuItem
                  key={emoji}
                  aria-label={emoji}
                  aria-pressed={myReaction === emoji}
                  selected={myReaction === emoji}
                  onClick={() => {
                    handlers.onReact(m, myReaction === emoji ? '' : emoji);
                    setAnchor(null);
                  }}
                  sx={{ justifyContent: 'center', fontSize: 18, minWidth: 40 }}
                >
                  {emoji}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
        {m.content && (
          <IconButton
            size="small"
            aria-label={copied ? 'Texto copiado' : 'Copiar texto'}
            title="Copiar texto"
            sx={iconSx}
            onClick={copy}
            onMouseLeave={() => setCopied(false)}
          >
            <Copy size={15} />
          </IconButton>
        )}
        {m.message_type === 'outgoing' && (
          <IconButton
            size="small"
            aria-label="Apagar"
            title="Apagar"
            sx={iconSx}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={15} />
          </IconButton>
        )}
      </Box>
      {confirm && (
        <C3Provider>
          <ActionDialog
            open
            title="Apagar mensagem?"
            description={
              m.private
                ? 'A nota privada será removida da conversa.'
                : 'A mensagem será apagada para todos, inclusive no WhatsApp do contato.'
            }
            confirmLabel="Apagar"
            backLabel="Cancelar"
            tone="danger"
            onClose={() => setConfirm(false)}
            onConfirm={() => {
              setConfirm(false);
              handlers.onDelete(m);
            }}
          />
        </C3Provider>
      )}
    </>
  );
}
