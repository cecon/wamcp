// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import {
  AlertTriangle,
  BellOff,
  MessageCircle,
  SignalHigh,
  SignalLow,
  SignalMedium,
  UserRound,
} from 'lucide-react';

import { timeAgo } from '../api';
import type { Conversation, Label } from '../types';
import { SlaBadge } from '../sla/SlaBadge';
import { Avatar } from '../ui/Avatar';
import { plainMentions } from './mentions';

const PRIORITY = {
  urgent: <AlertTriangle size={14} className="text-n-ruby-11" aria-label="Prioridade urgente" />,
  high: <SignalHigh size={14} className="text-n-amber-11" aria-label="Prioridade alta" />,
  medium: <SignalMedium size={14} className="text-n-amber-11" aria-label="Prioridade média" />,
  low: <SignalLow size={14} className="text-n-slate-10" aria-label="Prioridade baixa" />,
};

interface Props {
  conversation: Conversation;
  labels: Label[];
  selected: boolean;
  onSelect: () => void;
  /** Bulk selection checkbox over the avatar (on hover, always while selecting). */
  checked?: boolean;
  selecting?: boolean;
  onCheck?: (checked: boolean) => void;
}

/** Linha da lista de conversas no C3Theme (lote 16): meta, nome, prévia, etiquetas e não lidas. */
export function ConversationCard({
  conversation: c,
  labels,
  selected,
  onSelect,
  checked = false,
  selecting = false,
  onCheck,
}: Props) {
  const unread = c.unread_count > 0;
  const hasSla = c.sla_status === 'missed' || c.sla_status === 'active';
  const name = c.contact_name || c.contact_phone || 'Contato';
  const color = (title: string) => labels.find((l) => l.title === title)?.color || '#8B8D98';
  return (
    <Box component="li" sx={{ position: 'relative' }}>
      {onCheck && (
        <Checkbox
          size="small"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
          slotProps={{ input: { 'aria-label': `Selecionar conversa #${c.display_id}` } }}
          sx={{
            position: 'absolute',
            top: 28,
            left: 8,
            zIndex: 10,
            opacity: selecting ? 1 : 0,
            transition: 'opacity .1s',
            '.group:hover &, &:focus-within': { opacity: 1 },
          }}
        />
      )}
      <ButtonBase
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        sx={{
          display: 'flex',
          width: '100%',
          alignItems: 'flex-start',
          textAlign: 'left',
          px: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: selected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
        }}
      >
        <Box sx={{ mt: 4, ml: 3.5 }}>
          <Avatar name={name} src={c.contact_avatar_url} size={32} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, py: 1.5 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', pr: 8, color: 'text.secondary' }}>
            <MessageCircle size={14} style={{ flexShrink: 0 }} />
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {c.inbox_name}
            </Typography>
            {c.assignee_name && (
              <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', minWidth: 0, ml: 0.5 }}>
                <UserRound size={12} style={{ flexShrink: 0 }} />
                <Typography variant="caption" sx={{ fontWeight: 500, minWidth: 0 }} noWrap>
                  {c.assignee_name}
                </Typography>
              </Stack>
            )}
            {c.muted ? (
              <Box component="span" sx={{ ml: 'auto', display: 'flex' }}>
                <BellOff size={14} className="text-n-slate-10" aria-label="Conversa silenciada" />
              </Box>
            ) : null}
            {c.priority && (
              <Box component="span" sx={{ flexShrink: 0, ml: c.muted ? 0 : 'auto' }}>
                {PRIORITY[c.priority]}
              </Box>
            )}
          </Stack>
          <Typography variant="body2" noWrap sx={{ mx: 1, pt: 0.25, pr: 8, fontWeight: unread ? 600 : 500 }}>
            {name}
          </Typography>
          <Typography
            variant="body2"
            noWrap
            sx={{
              mx: 1,
              height: 24,
              lineHeight: '24px',
              color: unread ? 'text.primary' : 'text.secondary',
              fontWeight: unread ? 500 : 400,
            }}
          >
            {c.last_message ? plainMentions(c.last_message) : '—'}
          </Typography>
          {(c.labels.length > 0 || hasSla) && (
            <Stack
              direction="row"
              spacing={1.25}
              sx={{ mx: 1, mt: 0.25, height: 24, alignItems: 'center', overflow: 'hidden' }}
            >
              <SlaBadge status={c.sla_status} />
              {c.labels.map((title) => (
                <Stack
                  key={title}
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: 'center', flexShrink: 0 }}
                >
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color(title) }} />
                  <Typography variant="body2" color="text.secondary">
                    {title}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
        <Stack sx={{ position: 'absolute', top: 32, right: 12, alignItems: 'flex-end' }}>
          <Typography variant="caption" color="text.secondary">
            {timeAgo(c.last_activity_at)}
          </Typography>
          {unread && (
            <Box
              sx={{
                mt: 0.5,
                display: 'flex',
                height: 16,
                minWidth: 16,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 99,
                bgcolor: 'success.main',
                color: 'success.contrastText',
                px: 0.5,
                fontSize: 10,
                fontWeight: 500,
              }}
            >
              {c.unread_count > 9 ? '9+' : c.unread_count}
            </Box>
          )}
        </Stack>
      </ButtonBase>
    </Box>
  );
}
