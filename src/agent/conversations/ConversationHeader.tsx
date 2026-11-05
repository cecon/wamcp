import { useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { AlarmClockMinus, ArrowLeft, BellOff, ChevronDown, CircleDotDashed, PanelRight } from 'lucide-react';

import type { Conversation, ConversationStatus } from '../types';
import { Avatar } from '../ui/Avatar';

const SNOOZE: { label: string; hours: number }[] = [
  { label: 'Por 1 hora', hours: 1 },
  { label: 'Até amanhã', hours: 24 },
  { label: 'Por uma semana', hours: 24 * 7 },
];

interface Props {
  conversation: Conversation;
  panelOpen: boolean;
  onBack: () => void;
  onTogglePanel: () => void;
  onStatus: (status: ConversationStatus, snoozedUntil?: number) => void;
  /**
   * Inboxes with an AI agent: hands the conversation back to it (it becomes the assignee again, the
   * conversation stays open). Without it, "Passar para a IA" moves a legacy bot inbox to `pending`.
   */
  onHandToAi?: () => void;
  /** Extra header actions (the conversation "more" menu). */
  menu?: ReactNode;
}

/** Cabeçalho da conversa no C3Theme (lote 16): voltar, contato, resolver/abrir e o menu de status. */
export function ConversationHeader({
  conversation: c,
  panelOpen,
  onBack,
  onTogglePanel,
  onStatus,
  onHandToAi,
  menu,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = c.contact_name || c.contact_phone || 'Contato';
  const main =
    c.status === 'open'
      ? { label: 'Resolver', status: 'resolved' as const }
      : c.status === 'pending'
        ? { label: 'Abrir', status: 'open' as const }
        : { label: 'Reabrir', status: 'open' as const };
  const snoozedUntil =
    c.status === 'snoozed' && c.snoozed_until
      ? new Date(c.snoozed_until * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : null;
  return (
    <Stack
      component="header"
      direction="row"
      spacing={1}
      sx={{
        height: 48,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: 1,
        borderColor: 'divider',
        px: 1.5,
        pt: 1.5,
        pb: 1,
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ minWidth: 0, alignItems: 'center' }}>
        <IconButton
          size="small"
          aria-label="Voltar"
          onClick={onBack}
          sx={{ mr: 0.5, display: { xs: 'inline-flex', md: 'none' } }}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <Avatar name={name} src={c.contact_avatar_url} size={32} />
        <Box sx={{ ms: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500, lineHeight: 1.2 }}>
              {name}
            </Typography>
            {c.muted ? (
              <BellOff size={12} className="text-n-slate-10" aria-label="Conversa silenciada" />
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap component="p">
            #{c.display_id} • {c.inbox_name}
            {c.status === 'pending' && (
              <Box component="span" sx={{ color: 'info.main' }}>
                {' '}
                • com a IA
              </Box>
            )}
            {snoozedUntil && (
              <Box component="span" sx={{ color: 'warning.main' }}>
                {' '}
                • adiada até {snoozedUntil}
              </Box>
            )}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', borderRadius: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onStatus(main.status)}
            sx={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          >
            {main.label}
          </Button>
          <IconButton
            size="small"
            aria-label="Mais ações de status"
            onClick={(event) => setAnchor(event.currentTarget)}
            sx={{ border: 1, borderColor: 'divider', borderRadius: '0 4px 4px 0', borderLeft: 0 }}
          >
            <ChevronDown size={16} />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {c.status !== 'snoozed' &&
              SNOOZE.map((snooze) => (
                <MenuItem
                  key={snooze.hours}
                  onClick={() => {
                    onStatus('snoozed', Math.floor(Date.now() / 1000) + snooze.hours * 3600);
                    setAnchor(null);
                  }}
                >
                  <AlarmClockMinus size={14} style={{ marginRight: 8 }} />
                  Adiar {snooze.label.toLowerCase()}
                </MenuItem>
              ))}
            {(onHandToAi ? Boolean(c.assignee_id) : c.status !== 'pending') && (
              <MenuItem
                onClick={() => {
                  if (onHandToAi) onHandToAi();
                  else onStatus('pending');
                  setAnchor(null);
                }}
              >
                <CircleDotDashed size={14} style={{ marginRight: 8 }} />
                Passar para a IA
              </MenuItem>
            )}
          </Menu>
        </Box>
        {menu}
        <IconButton
          size="small"
          aria-label={panelOpen ? 'Ocultar painel do contato' : 'Mostrar painel do contato'}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
        >
          <PanelRight size={16} />
        </IconButton>
      </Stack>
    </Stack>
  );
}
