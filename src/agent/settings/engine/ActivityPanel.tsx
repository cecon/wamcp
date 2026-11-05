import { useEffect } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Check, X } from 'lucide-react';

import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import { StatusPill } from './StatusPill';
import { CALL_STATUS, isFinal, type ActivityDetail, type EngineRun } from './types';

interface Props {
  id: number;
  name: (agentId: number) => string;
  onClose: () => void;
  onChanged: () => void;
}

function usage(runs: EngineRun[]) {
  const tokens = runs.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);
  const cost = runs.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  const estimated = runs.some((r) => r.cost_source === 'estimated');
  return `${runs.length} execução${runs.length === 1 ? '' : 'ões'} · ${tokens.toLocaleString('pt-BR')} tokens · US$ ${cost.toFixed(4)}${estimated ? ' (estimado)' : ''}`;
}

/** One request end to end: the delegation tree, tool calls (with approvals), evidence, usage and audit. */
export function ActivityPanel({ id, name, onClose, onChanged }: Props) {
  const { data, error, reload } = useFetch<ActivityDetail>(`/engine/activities/${id}`);
  const action = useAction();
  const done = data ? isFinal(data.activity.status) : false;

  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(reload, 2000);
    return () => window.clearInterval(timer);
  }, [done, reload]);

  const decide = (callId: number, approve: boolean) =>
    void action.run(async () => {
      await http(`/engine/tool_calls/${callId}/decision`, 'POST', { approve });
      reload();
      onChanged();
    });

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose} scroll="paper">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Pedido #{id}
        <IconButton size="small" aria-label="Fechar" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          {(error || action.error) && (
            <Typography role="alert" variant="body2" sx={{ color: 'error.main' }}>
              {error || action.error}
            </Typography>
          )}
          {!data && !error && (
            <Typography variant="body2" color="text.secondary">
              Carregando…
            </Typography>
          )}
          {data?.tree.map(({ activity, runs, tool_calls, evidence, messages }) => {
            const delegation = data.delegations.find((d) => d.activity_id === activity.id);
            return (
              <Box
                key={activity.id}
                component="section"
                aria-label={`Atividade de ${name(activity.agent_id)}`}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 2,
                  ms: activity.parent_id ? 3 : 0,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">
                    <Typography component="span" sx={{ fontWeight: 600 }}>
                      {name(activity.agent_id)}
                    </Typography>
                    {delegation && (
                      <Typography component="span" variant="body2" color="text.secondary">
                        {' '}
                        · delegado por {name(delegation.from_agent_id)} (skill {delegation.skill}, salto{' '}
                        {delegation.hops})
                      </Typography>
                    )}
                  </Typography>
                  <StatusPill status={activity.status} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Pedido: {activity.request}
                </Typography>
                {activity.result && <Typography variant="body2">Resposta: {activity.result}</Typography>}
                {activity.error && (
                  <Typography variant="body2" sx={{ color: 'error.main' }}>
                    Erro: {activity.error}
                  </Typography>
                )}
                {activity.evidence.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Evidências citadas: {activity.evidence.join(', ')}
                  </Typography>
                )}
                {tool_calls.map((call) => (
                  <Stack
                    key={call.id}
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      px: 2,
                      py: 1,
                    }}
                  >
                    <Typography component="code" variant="caption">
                      {call.tool}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {JSON.stringify(call.args)}
                    </Typography>
                    <Typography variant="caption">→ {CALL_STATUS[call.status]}</Typography>
                    {call.evidence_id && (
                      <Typography variant="caption" color="text.secondary">
                        ({call.evidence_id})
                      </Typography>
                    )}
                    {call.status === 'pending_approval' && (
                      <Stack direction="row" spacing={0.5} sx={{ ml: 'auto' }}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<Check size={14} />}
                          disabled={action.busy}
                          onClick={() => decide(call.id, true)}
                        >
                          Aprovar
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<X size={14} />}
                          disabled={action.busy}
                          onClick={() => decide(call.id, false)}
                        >
                          Recusar
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                ))}
                {evidence.length > 0 && (
                  <Box component="details">
                    <Typography
                      component="summary"
                      variant="caption"
                      color="text.secondary"
                      sx={{ cursor: 'pointer' }}
                    >
                      Evidências ({evidence.length})
                    </Typography>
                    {evidence.map((e) => (
                      <Box
                        key={e.id}
                        component="pre"
                        sx={{
                          mt: 1,
                          overflowX: 'auto',
                          borderRadius: 1,
                          bgcolor: 'action.hover',
                          p: 1,
                          fontSize: '0.75rem',
                          m: 0,
                        }}
                      >
                        {e.id} · {e.source}
                        {'\n'}
                        {JSON.stringify(e.content, null, 2)}
                      </Box>
                    ))}
                  </Box>
                )}
                {messages.length > 0 && (
                  <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
                    {messages.map((m) => (
                      <Typography component="li" key={m.id} variant="caption" color="text.secondary">
                        <Typography component="span" variant="caption" sx={{ fontWeight: 600 }}>
                          {m.from_agent_id ? name(m.from_agent_id) : '—'} →{' '}
                          {m.to_agent_id ? name(m.to_agent_id) : '—'}:
                        </Typography>{' '}
                        {m.body}
                      </Typography>
                    ))}
                  </Stack>
                )}
                {runs.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {usage(runs)}
                  </Typography>
                )}
              </Box>
            );
          })}
          {data && data.audit.length > 0 && (
            <Box component="details">
              <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>
                Auditoria ({data.audit.length})
              </Typography>
              <Stack component="ol" spacing={0.5} sx={{ mt: 1, pl: 2 }}>
                {data.audit.map((a) => (
                  <Typography component="li" key={a.id} variant="caption" color="text.secondary">
                    {new Date(a.at).toLocaleTimeString('pt-BR')} · {a.agent_id ? name(a.agent_id) : 'Sistema'}{' '}
                    · {a.action} · {a.outcome}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
