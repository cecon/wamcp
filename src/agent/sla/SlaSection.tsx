import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import type { ConversationSla } from '../parityTypes';
import { formatSeconds } from '../reports/metrics';
import { useFetch } from '../useFetch';
import { THRESHOLDS, useSlaPolicies } from './sla';
import { useNow } from './useNow';

const STATUS: Record<
  ConversationSla['state']['status'],
  { label: string; color: 'info' | 'success' | 'error' }
> = {
  active: { label: 'Em andamento', color: 'info' },
  hit: { label: 'Cumprido', color: 'success' },
  missed: { label: 'Perdido', color: 'error' },
};
const DUE: Record<string, 'first_response_due_at' | 'next_response_due_at' | 'resolution_due_at'> = {
  first_response: 'first_response_due_at',
  next_response: 'next_response_due_at',
  resolution: 'resolution_due_at',
};

/** One SLA target: countdown while running, "perdido" once late, "—" when met or not applicable. */
function Deadline({ due, missed, now }: { due: number | null; missed: boolean; now: number }) {
  if (missed || (due !== null && due <= now))
    return <Chip size="small" color="error" label="perdido" sx={{ height: 20, fontSize: 12 }} />;
  if (due === null)
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        —
      </Typography>
    );
  return (
    <Typography component="span" variant="body2">
      vence em {formatSeconds(due - now)}
    </Typography>
  );
}

/** Chatwoot conversation SLA: applied policy, its deadlines and a selector to apply another one. */
export function SlaSection({ displayId }: { displayId: number }) {
  const path = `/conversations/${displayId}/sla`;
  const current = useFetch<ConversationSla | null>(path);
  const { policies } = useSlaPolicies();
  const [applied, setApplied] = useState<ConversationSla | null>(null),
    [choice, setChoice] = useState(''),
    [error, setError] = useState('');
  const now = useNow();
  const sla = applied || current.data;
  const apply = () =>
    http<ConversationSla>(path, 'POST', { sla_policy_id: Number(choice) })
      .then((result) => {
        setApplied(result);
        setChoice('');
        setError('');
      })
      .catch((e: Error) => setError(e.message));

  return (
    <Stack spacing={1.5}>
      {sla ? (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
              {sla.policy.name}
            </Typography>
            <Chip
              size="small"
              color={STATUS[sla.state.status].color}
              label={STATUS[sla.state.status].label}
              sx={{ height: 20, fontSize: 12 }}
            />
          </Stack>
          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              columnGap: 2,
              rowGap: 1,
              m: 0,
            }}
          >
            {THRESHOLDS.filter(({ key }) => sla.policy[key]).map(({ target, label }) => (
              <Box key={target} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Box component="dd" sx={{ m: 0 }}>
                  <Deadline
                    due={sla.state[DUE[target]]}
                    missed={sla.state.missed.includes(target)}
                    now={now}
                  />
                </Box>
              </Box>
            ))}
          </Box>
        </>
      ) : (
        !current.loading && (
          <Typography variant="body2" color="text.secondary">
            Nenhum SLA aplicado.
          </Typography>
        )
      )}
      {(error || current.error) && (
        <Typography variant="body2" color="error">
          {error || current.error}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Select
          native
          size="small"
          value={choice}
          inputProps={{ 'aria-label': 'Política de SLA' }}
          onChange={(event) => setChoice(String(event.target.value))}
          sx={{ minWidth: 180, fontSize: 14 }}
        >
          <option value="">{sla ? 'Trocar SLA…' : 'Selecione um SLA…'}</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button variant="outlined" size="small" disabled={!choice} onClick={() => void apply()}>
          Aplicar
        </Button>
      </Stack>
    </Stack>
  );
}
