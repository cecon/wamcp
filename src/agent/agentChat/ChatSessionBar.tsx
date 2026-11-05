import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { History, SquarePen } from 'lucide-react';

import { brl, chatTime, tokens, type ChatSessions } from './types';

interface Props {
  sessions: ChatSessions | null;
  /** The session on screen. */
  viewing: number;
  onView: (session: number) => void;
  onNew: () => void;
  busy: boolean;
}

/** Ações do cabeçalho do chat no C3Theme (lote 26): consumo, sessões anteriores e nova conversa. */
export function ChatSessionBar({ sessions, viewing, onView, onNew, busy }: Props) {
  const [open, setOpen] = useState(false);
  const shown = sessions?.sessions.find((s) => s.number === viewing);
  const used = shown && sessions ? Math.min(1, shown.tokens / sessions.token_limit) : 0;
  return (
    <Box
      sx={{
        position: 'relative',
        ml: 'auto',
        display: 'flex',
        flexShrink: 0,
        alignItems: 'center',
        gap: 0.5,
      }}
    >
      {shown && sessions && (
        <Stack
          spacing={0.5}
          sx={{ mr: 1, display: { xs: 'none', sm: 'flex' }, alignItems: 'flex-end' }}
          title={`Esta conversa usou ${shown.tokens.toLocaleString('pt-BR')} de ${sessions.token_limit.toLocaleString('pt-BR')} tokens`}
        >
          <Typography variant="caption" color="text.secondary">
            {tokens(shown.tokens)} de {tokens(sessions.token_limit)} tokens · {brl(shown.cost_brl)}
          </Typography>
          <Box
            aria-hidden
            sx={{ height: 4, width: 128, overflow: 'hidden', borderRadius: 99, bgcolor: 'action.hover' }}
          >
            <Box
              sx={{
                display: 'block',
                height: '100%',
                borderRadius: 99,
                bgcolor: used >= 0.9 ? 'var(--color-n-ruby-9)' : 'var(--color-n-iris-9)',
                width: `${used * 100}%`,
              }}
            />
          </Box>
        </Stack>
      )}
      <IconButton
        size="small"
        aria-label="Conversas anteriores"
        title="Conversas anteriores"
        onClick={() => setOpen(true)}
      >
        <History size={16} />
      </IconButton>
      {open && (
        <Box
          role="menu"
          aria-label="Conversas anteriores"
          sx={{
            position: 'absolute',
            right: 0,
            top: '100%',
            zIndex: 20,
            width: 320,
            maxHeight: 384,
            overflowY: 'auto',
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            boxShadow: 4,
            p: 1,
          }}
        >
          {(sessions?.sessions || []).map((s) => (
            <Button
              key={s.number}
              role="menuitem"
              fullWidth
              aria-current={s.number === viewing}
              onClick={() => {
                onView(s.number);
                setOpen(false);
              }}
              sx={{
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 0.25,
                px: 1,
                py: 0.75,
                mb: 0.5,
                textAlign: 'left',
                textTransform: 'none',
                bgcolor: s.number === viewing ? 'action.selected' : 'transparent',
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography variant="caption" color="text.secondary">
                  {s.number === sessions?.current ? 'Conversa atual' : chatTime(s.started_at)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {tokens(s.tokens)} tokens · {brl(s.cost_brl)}
                </Typography>
              </Stack>
              <Typography variant="body2" noWrap>
                {s.preview || 'Sem mensagens'}
              </Typography>
            </Button>
          ))}
        </Box>
      )}
      <IconButton
        size="small"
        aria-label="Nova conversa"
        title="Nova conversa"
        disabled={busy}
        onClick={onNew}
      >
        <SquarePen size={16} />
      </IconButton>
    </Box>
  );
}
