import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog, SelectField } from '@c3theme/ui';

import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { useAction } from '../useAction';
import type { EngineActivity } from './types';

interface Props {
  agents: RosterAgent[];
  onClose: () => void;
  onStarted: (id: number) => void;
}

/** A request to an AI agent through the internal channel (the answer stays on the activity). */
export function AskModal({ agents, onClose, onStarted }: Props) {
  const [agent, setAgent] = useState(agents[0]?.id ?? 0),
    [request, setRequest] = useState('');
  const { error, busy, run } = useAction();

  return (
    <ActionDialog
      open
      title="Novo pedido"
      description="O agente recebe o pedido, delega para quem tem a competência e responde citando as evidências."
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
      </Stack>
    </ActionDialog>
  );
}
