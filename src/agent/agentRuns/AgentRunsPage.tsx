import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// C3Theme
import { StatusChip } from '@c3theme/ui';
import type { StatusTone } from '@c3theme/ui';

import C3Provider from '../c3/C3Provider';
import type { Route } from '../route';
import { elapsed, KIND_LABEL, STATE_LABEL, type AgentRun } from './types';

const TONE: Record<string, StatusTone> = { queued: 'neutral', running: 'info', waiting_approval: 'warning' };

interface Props {
  runs: AgentRun[];
  error: string;
  onNavigate: (route: Route) => void;
}

/** Para onde "Abrir" leva: a conversa, o chat com o agente, o motor ou os agendamentos. */
function target(run: AgentRun): Route | undefined {
  if (run.kind === 'conversation' && run.display_id)
    return { page: 'conversations', displayId: run.display_id };
  if (run.kind === 'chat' && run.agent_id) return { page: 'agent_chat', agentId: run.agent_id };
  if (run.kind === 'engine') return { page: 'settings', section: 'engine' };
  if (run.kind === 'schedule') return { page: 'settings', section: 'schedules' };
  return undefined;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

function RunRow({ run, now, onNavigate }: { run: AgentRun; now: number; onNavigate: Props['onNavigate'] }) {
  const to = target(run);
  const where = [KIND_LABEL[run.kind], run.inbox_name].filter(Boolean).join(' · ');
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr auto', md: '170px minmax(0, 1fr) minmax(0, 1.2fr) 64px auto' },
        alignItems: 'center',
        gap: { xs: 1, md: 2 },
        px: 2,
        py: 1.25,
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <StatusChip label={STATE_LABEL[run.state] ?? run.state} tone={TONE[run.state] ?? 'neutral'} />
        {run.again && (
          <Typography
            variant="caption"
            color="text.secondary"
            title="Chegou mensagem nova: roda de novo depois"
          >
            +1
          </Typography>
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap title={run.title}>
          {run.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="p">
          {where}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        noWrap
        title={run.detail ?? undefined}
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        {run.detail ?? (run.state === 'queued' ? 'Aguardando vaga do runtime' : 'Pensando…')}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontVariantNumeric: 'tabular-nums', display: { xs: 'none', md: 'block' } }}
        title={run.started_at ? 'Tempo trabalhando' : 'Tempo na fila'}
      >
        {elapsed(run.started_at ?? run.queued_at, now)}
      </Typography>
      <Button size="small" variant="outlined" disabled={!to} onClick={() => to && onNavigate(to)}>
        Abrir
      </Button>
    </Box>
  );
}

/** "Agentes ao vivo": cada linha é uma sessão; o mesmo agente pode ter várias rodando ao mesmo tempo. */
export function AgentRunsPage({ runs, error, onNavigate }: Props) {
  const now = useNow();
  const [state, setState] = useState<string | null>(null);
  const shown = runs.filter((r) => !state || r.state === state);
  const byAgent = new Map<string, AgentRun[]>();
  for (const run of [...shown].sort((a, b) => a.queued_at - b.queued_at)) {
    const name = run.agent_name ?? (run.agent_id ? `Agente #${run.agent_id}` : 'Agente');
    byAgent.set(name, [...(byAgent.get(name) ?? []), run]);
  }
  const groups = [...byAgent.entries()];
  const count = (s: string) => runs.filter((r) => r.state === s).length;

  return (
    <C3Provider>
      <Box component="section" aria-label="Agentes ao vivo" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200 }}>
        <Typography variant="h4" component="h1">
          Agentes ao vivo
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Cada linha é uma sessão. O mesmo agente pode ter várias ao mesmo tempo; as que passam da capacidade
          dos runtimes esperam na fila.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
          <Chip
            label={`Todas · ${runs.length}`}
            color={state ? 'default' : 'primary'}
            onClick={() => setState(null)}
          />
          {Object.keys(STATE_LABEL).map((s) => (
            <Chip
              key={s}
              label={`${STATE_LABEL[s]} · ${count(s)}`}
              color={state === s ? 'primary' : 'default'}
              variant={state === s ? 'filled' : 'outlined'}
              onClick={() => setState(state === s ? null : s)}
            />
          ))}
        </Stack>
        {error && (
          <Typography color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}
        {!groups.length && !error && (
          <Paper variant="outlined" sx={{ mt: 3, p: 4, textAlign: 'center' }}>
            <Typography variant="subtitle1">Nenhum agente trabalhando agora.</Typography>
            <Typography variant="body2" color="text.secondary">
              Uma sessão aparece aqui assim que entra na fila e sai quando a resposta é enviada.
            </Typography>
          </Paper>
        )}
        <Stack spacing={2} sx={{ mt: 3 }}>
          {groups.map(([name, list]) => (
            <Paper key={name} variant="outlined" sx={{ overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 2, py: 1.5 }}>
                <Typography variant="subtitle1" component="h2">
                  {name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {list.length === 1 ? '1 sessão' : `${list.length} sessões em paralelo`}
                </Typography>
              </Box>
              {list.map((run) => (
                <RunRow key={run.id} run={run} now={now} onNavigate={onNavigate} />
              ))}
            </Paper>
          ))}
        </Stack>
      </Box>
    </C3Provider>
  );
}
