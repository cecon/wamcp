import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../../api';
import type { AgentCredential } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import { CREDENTIAL_KINDS } from './labels';

interface Props {
  agentId: number;
  onChange: () => void;
}

/** Credentials of an AI agent: secrets are write-only and encrypted on the server. */
export function CredentialsPanel({ agentId, onChange }: Props) {
  const path = `/agent_directory/${agentId}/credentials`;
  const { data, reload } = useFetch<AgentCredential[]>(path);
  const [form, setForm] = useState({ name: '', kind: CREDENTIAL_KINDS[0].value as string, secret: '' });
  const { error, busy, run } = useAction();
  const changed = () => {
    reload();
    onChange();
  };

  return (
    <Box
      component="section"
      aria-label="Credenciais"
      sx={{
        mt: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        borderTop: 1,
        borderColor: 'divider',
        pt: 2,
      }}
    >
      <Typography variant="h6" component="h3">
        Credenciais
      </Typography>
      <Typography variant="body2">
        Usadas pelas ferramentas do agente no servidor; o modelo nunca vê o segredo, que fica cifrado e não
        pode ser lido de volta.
      </Typography>
      <Box
        component="ul"
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, m: 0, p: 0, listStyle: 'none' }}
      >
        {(data || []).map((c) => (
          <Stack
            key={c.id}
            component="li"
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}
          >
            <Box component="span">
              <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
                {c.name}
              </Typography>{' '}
              <Typography component="span" variant="body2" color="text.secondary">
                {CREDENTIAL_KINDS.find((k) => k.value === c.kind)?.label}
              </Typography>
            </Box>
            <Button
              size="small"
              color="error"
              variant="outlined"
              aria-label={`Remover credencial ${c.name}`}
              onClick={() =>
                void run(async () => {
                  await http(`${path}/${c.id}`, 'DELETE');
                  changed();
                })
              }
            >
              Remover
            </Button>
          </Stack>
        ))}
        {data?.length === 0 && (
          <Typography component="li" variant="body2">
            Nenhuma credencial.
          </Typography>
        )}
      </Box>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}
      >
        <TextField
          size="small"
          placeholder="nome (ex.: erp_api)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          slotProps={{ htmlInput: { required: true, maxLength: 60, 'aria-label': 'Nome da credencial' } }}
        />
        <Box
          component="select"
          aria-label="Tipo da credencial"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          sx={{
            height: 40,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            color: 'text.primary',
            px: 1,
          }}
        >
          {CREDENTIAL_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Box>
        <TextField
          size="small"
          type="password"
          autoComplete="new-password"
          placeholder="segredo"
          value={form.secret}
          onChange={(e) => setForm({ ...form, secret: e.target.value })}
          slotProps={{ htmlInput: { required: true, 'aria-label': 'Segredo' } }}
        />
        <Box sx={{ gridColumn: { sm: 'span 3' } }}>
          <Button
            type="button"
            variant="contained"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await http(path, 'POST', { ...form, name: form.name.trim() });
                setForm({ ...form, name: '', secret: '' });
                changed();
              })
            }
          >
            Adicionar credencial
          </Button>
        </Box>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
