import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { Inbox } from '../types';

interface Props {
  inbox: Inbox;
  busy: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<boolean>;
}

/** Limite de conversas por agente no C3Theme (lote 29): vazio = sem limite. */
export function InboxLimit({ inbox, busy, onSave }: Props) {
  const initial = inbox.max_assignment_limit ? String(inbox.max_assignment_limit) : '';
  const [limit, setLimit] = useState(initial),
    [saved, setSaved] = useState(false);
  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void onSave({ max_assignment_limit: limit.trim() ? Number(limit) : null }).then(setSaved);
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, borderTop: 1, borderColor: 'divider', py: 1.5 }}
    >
      <Typography variant="h6" component="span">
        Limite de conversas por agente
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Máximo de conversas abertas que a atribuição automática entrega a cada agente. Deixe vazio para não
        limitar.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          label="Limite de conversas por agente"
          type="number"
          size="small"
          placeholder="Sem limite"
          value={limit}
          onChange={(e) => {
            setSaved(false);
            setLimit(e.target.value);
          }}
          slotProps={{ htmlInput: { min: 1, max: 1000 } }}
          sx={{ width: 200 }}
        />
        <Button type="submit" variant="outlined" disabled={busy || limit === initial}>
          Salvar limite
        </Button>
      </Stack>
      {saved && (
        <Typography variant="body2" sx={{ color: 'success.main' }}>
          Limite salvo.
        </Typography>
      )}
    </Box>
  );
}
