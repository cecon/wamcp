// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

// third-party
import { CircleAlert, CircleCheck, CirclePause, Hand, UserRoundCheck } from 'lucide-react';

// C3Theme
import { EmptyState, Panel, SoftAvatar, type Tone } from '@c3theme/ui';

import type { AttentionItem } from './summary';

interface Props {
  items: AttentionItem[];
  busy: boolean;
  onOpenActivity: (id: number) => void;
  onOpenConversation: (displayId: number) => void;
  onResume?: () => void;
}

const ICON = { paused: CirclePause, approval: Hand, error: CircleAlert, handoff: UserRoundCheck };
const TONE: Record<AttentionItem['kind'], Tone> = {
  paused: 'warning',
  approval: 'warning',
  error: 'danger',
  handoff: 'neutral',
};

/** "Espera por você": aprovações, erros, pausa e as conversas que ele passou para pessoas, com o motivo. */
export function AttentionList({ items, busy, onOpenActivity, onOpenConversation, onResume }: Props) {
  return (
    <Box component="section" aria-label="Espera por você">
      <Panel title="Espera por você">
        {!items.length && (
          <EmptyState
            dense
            icon={<CircleCheck size={22} />}
            title="Nada esperando"
            description="Nenhuma aprovação pendente, nenhum erro e nenhuma conversa passada adiante no período."
          />
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
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}
              >
                <SoftAvatar tone={TONE[item.kind]} size="sm" aria-hidden>
                  <Icon size={16} />
                </SoftAvatar>
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
      </Panel>
    </Box>
  );
}
