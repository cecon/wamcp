// material-ui
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useState } from 'react';
import { http } from '../../api';
import { useAction } from '../useAction';

/** Troca o token de uma caixa GitHub conectada por token; o servidor recria o webhook em seguida. */
export function GithubTokenForm<T>({ inboxId, onSaved }: { inboxId: number; onSaved: (setup: T) => void }) {
  const [token, setToken] = useState('');
  const { error, busy, run } = useAction();
  return (
    <Stack
      component="form"
      spacing={1}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          onSaved(await http<T>(`/inboxes/${inboxId}/github/token`, 'PUT', { token }));
          setToken('');
        });
      }}
    >
      <TextField
        size="small"
        label="Novo token do GitHub"
        type="password"
        autoComplete="off"
        placeholder="github_pat_…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        sx={{ maxWidth: 420 }}
      />
      <Typography variant="caption" color="text.secondary">
        Fine-grained token com acesso a este repositório: Webhooks, Pull requests, Issues e Contents (leitura
        e escrita), Checks e Actions (leitura).
      </Typography>
      <Button
        type="submit"
        variant="outlined"
        disabled={busy || !token.trim()}
        sx={{ alignSelf: 'flex-start' }}
      >
        {busy ? 'Salvando…' : 'Salvar token e criar webhook'}
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
