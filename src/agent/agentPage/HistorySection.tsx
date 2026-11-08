import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { RUN_LABEL } from '../settings/schedules/types';
import { StatusPill } from '../settings/engine/StatusPill';
import type { EngineActivity } from '../settings/engine/types';
import type { AgentHistory } from './types';

interface Props {
  history: AgentHistory | null;
  activities: EngineActivity[];
  onOpenActivity: (id: number) => void;
  onOpenConversation: (displayId: number) => void;
}

type View = 'conversations' | 'engine' | 'schedules';

const when = (ms: number) =>
  new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const ROW_SX = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 1.5,
  py: 1,
  borderBottom: 1,
  borderColor: 'divider',
} as const;

const Empty = ({ children }: { children: string }) => (
  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
    {children}
  </Typography>
);

/** Histórico do período: conversas atendidas, pedidos do motor (com passos e ferramentas) e rotinas. */
export function HistorySection({ history, activities, onOpenActivity, onOpenConversation }: Props) {
  const [view, setView] = useState<View>('conversations');
  const conversations = history?.conversations ?? [];
  const runs = history?.schedule_runs ?? [];
  const sorted = [...activities].sort((a, b) => b.id - a.id);
  return (
    <>
      <Tabs
        value={view}
        onChange={(_e, value: View) => setView(value)}
        aria-label="Histórico"
        sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          value="conversations"
          label={`Conversas · ${conversations.length}`}
          sx={{ textTransform: 'none' }}
        />
        <Tab value="engine" label={`Pedidos do motor · ${sorted.length}`} sx={{ textTransform: 'none' }} />
        <Tab value="schedules" label={`Rotinas · ${runs.length}`} sx={{ textTransform: 'none' }} />
      </Tabs>
      <Box role="tabpanel">
        {view === 'conversations' &&
          (conversations.length ? (
            conversations.map((c) => (
              <Box key={c.id} sx={ROW_SX}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    #{c.display_id} · {c.contact_name ?? 'Contato'}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      · {c.inbox_name} · respondeu {c.turns}×
                    </Typography>
                  </Typography>
                  {c.handed_to && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Passou para {c.handed_to}
                      {c.handoff_reason ? `: ${c.handoff_reason}` : ''}
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {when(Date.parse(c.last_at))}
                </Typography>
                <Button size="small" onClick={() => onOpenConversation(c.display_id)}>
                  Abrir
                </Button>
              </Box>
            ))
          ) : (
            <Empty>Nenhuma conversa atendida no período.</Empty>
          ))}
        {view === 'engine' &&
          (sorted.length ? (
            sorted.map((a) => (
              <Box key={a.id} sx={ROW_SX}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    #{a.id} · {a.request}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {a.parent_id ? `Delegado pelo pedido #${a.parent_id}` : `Pedido de ${a.requester}`}
                  </Typography>
                </Box>
                <StatusPill status={a.status} />
                <Button size="small" onClick={() => onOpenActivity(a.id)}>
                  Passos
                </Button>
              </Box>
            ))
          ) : (
            <Empty>Nenhum pedido no motor.</Empty>
          ))}
        {view === 'schedules' &&
          (runs.length ? (
            runs.map((r) => (
              <Box key={r.id} sx={{ ...ROW_SX, flexDirection: 'column', alignItems: 'stretch', gap: 0.25 }}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
                    {r.schedule_name}
                  </Typography>
                  <Typography variant="caption">{RUN_LABEL[r.status]}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {when(r.started_at)}
                  </Typography>
                </Box>
                {(r.error || r.output) && (
                  <Typography
                    variant="caption"
                    color={r.error ? 'error' : 'text.secondary'}
                    sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 96, overflow: 'auto' }}
                  >
                    {r.error ?? r.output}
                  </Typography>
                )}
              </Box>
            ))
          ) : (
            <Empty>Nenhuma rotina rodou no período.</Empty>
          ))}
      </Box>
    </>
  );
}
