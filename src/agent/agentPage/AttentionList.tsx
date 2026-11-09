// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

// third-party
import { CircleAlert, CirclePause, Hand, UserRoundCheck } from 'lucide-react';

import type { AttentionItem } from './summary';

interface Props {
  items: AttentionItem[];
  busy: boolean;
  onOpenActivity: (id: number) => void;
  onOpenConversation: (displayId: number) => void;
  onResume?: () => void;
}

const ICON = { paused: CirclePause, approval: Hand, error: CircleAlert, handoff: UserRoundCheck };
const COLOR = {
  paused: 'var(--color-n-amber-11)',
  approval: 'var(--color-n-amber-11)',
  error: 'var(--color-n-ruby-11)',
  handoff: 'var(--color-n-slate-11)',
};

/** "Espera por você": aprovações, erros, pausa e as conversas que ele passou para pessoas, com o motivo. */
export function AttentionList({ items, busy, onOpenActivity, onOpenConversation, onResume }: Props) {
  return (
    <Paper component="section" variant="outlined" aria-label="Espera por você" sx={{ p: 2 }}>
      <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
        Espera por você
      </Typography>
      {!items.length && (
        <Typography variant="body2" color="text.secondary">
          Nada esperando: nenhuma aprovação pendente, nenhum erro e nenhuma conversa passada adiante no
          período.
        </Typography>
      )}
      <Box
        component="ul"
        sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {items.map((item) => {
          const Icon = ICON[item.kind];
          return (
            <Box
              key={item.key}
              component="li"
              sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 0.5 }}
            >
              <Box component={Icon} size={18} sx={{ color: COLOR[item.kind], flexShrink: 0, mt: 0.25 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {item.title}
                </Typography>
                {item.detail && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', overflowWrap: 'anywhere' }}
                  >
                    {item.detail}
                  </Typography>
                )}
              </Box>
              {item.kind === 'paused' && onResume && (
                <Button size="small" variant="contained" disabled={busy} onClick={onResume}>
                  Retomar
                </Button>
              )}
              {item.activityId !== undefined && (
                <Button size="small" variant="outlined" onClick={() => onOpenActivity(item.activityId!)}>
                  {item.kind === 'approval' ? 'Decidir' : 'Ver'}
                </Button>
              )}
              {item.displayId !== undefined && (
                <Button size="small" variant="outlined" onClick={() => onOpenConversation(item.displayId!)}>
                  Abrir conversa
                </Button>
              )}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
