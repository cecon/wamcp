import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog, SelectField } from '@c3theme/ui';

import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import type { User } from '../../types';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import type { EngineActivity } from './types';

interface Props {
  agents: RosterAgent[];
  onClose: () => void;
  onStarted: (id: number) => void;
}

/**
 * A request to an AI agent. When it ends (or waits for an approval) the answer comes back to your chat
 * with the agent, and to the people you copy.
 */
export function AskModal({ agents, onClose, onStarted }: Props) {
  const [agent, setAgent] = useState(agents[0]?.id ?? 0),
    [request, setRequest] = useState(''),
    [copies, setCopies] = useState<number[]>([]);
  const people = useFetch<User[]>('/agents');
  const me = useFetch<{ user: User }>('/auth/me');
  const others = (people.data || []).filter((u) => u.id !== me.data?.user.id);
  const toggle = (id: number) =>
    setCopies((list) => (list.includes(id) ? list.filter((c) => c !== id) : [...list, id]));
  const { error, busy, run } = useAction();

  return (
    <ActionDialog
      open
      title="Novo pedido"
      description="O agente recebe o pedido, delega para quem tem a competência e responde citando as evidências. A resposta volta para o seu chat com o agente."
      confirmLabel="Enviar"
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          const started = await http<EngineActivity>('/engine/activities', 'POST', {
            agent_id: agent,
            request: request.trim(),
            copies: copies.map((id) => ({ kind: 'user', id })),
          });
          onStarted(started.id);
          onClose();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <SelectField
          native
          size="small"
          label="Agente"
          value={agent}
          onChange={(value) => setAgent(value ?? 0)}
          options={agents.map((a) => ({ value: a.id, label: a.name }))}
        />
        <TextField
          label="Pedido"
          size="small"
          multiline
          minRows={3}
          placeholder="Lu, o cliente ACME pagou?"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          slotProps={{ htmlInput: { required: true, maxLength: 4000 } }}
        />
        {others.length > 0 && (
          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Typography component="legend" variant="body2" sx={{ mb: 0.5 }}>
              Avisar também (no chat de cada um com o agente)
            </Typography>
            {others.map((u) => (
              <FormControlLabel
                key={u.id}
                control={
                  <Checkbox size="small" checked={copies.includes(u.id)} onChange={() => toggle(u.id)} />
                }
                label={u.name}
              />
            ))}
          </Box>
        )}
      </Stack>
    </ActionDialog>
  );
}
