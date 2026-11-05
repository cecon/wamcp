import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError, firstRun, http } from '../api';
import { authError, type LoginResult } from './authError';

interface Props {
  onSignedIn: (result: LoginResult) => void;
  /** The administrator exists (created now or meanwhile): back to the usual login with a message. */
  onExists: (message: string) => void;
}

const FIELDS = [
  { key: 'name', label: 'Nome', type: 'text', autoComplete: 'name' },
  { key: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
  { key: 'password', label: 'Senha (mínimo 10 caracteres)', type: 'password', autoComplete: 'new-password' },
  { key: 'confirm', label: 'Confirmar senha', type: 'password', autoComplete: 'new-password' },
] as const;
type Form = Record<(typeof FIELDS)[number]['key'], string>;

/** Primeiro acesso no C3Theme (lote 8): cria o primeiro administrador e entra com ele. */
export function Bootstrap({ onSignedIn, onExists }: Props) {
  const [form, setForm] = useState<Form>({ name: '', email: '', password: '', confirm: '' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit() {
    if (form.password.length < 10) return setError('A senha precisa ter pelo menos 10 caracteres.');
    if (form.password !== form.confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError('');
    const account = { name: form.name.trim(), email: form.email.trim(), password: form.password };
    try {
      await firstRun('/bootstrap', 'POST', account);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409)
        return onExists('Já existe um administrador. Entre com o e-mail e a senha.');
      return setError(authError(err));
    }
    try {
      onSignedIn(
        await http<LoginResult>('/auth/login', 'POST', { email: account.email, password: form.password }),
      );
    } catch (err) {
      // The account exists: the usual login screen takes over.
      onExists(authError(err));
    }
  }
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h4" component="h1">
            Criar administrador
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Primeiro acesso ao WA MCP. Esta conta conecta o WhatsApp e cadastra os demais agentes.
          </Typography>
        </Box>
        <Stack spacing={2}>
          {FIELDS.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              type={field.type}
              size="small"
              value={form[field.key]}
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
              slotProps={{
                htmlInput: {
                  required: true,
                  autoComplete: field.autoComplete,
                  maxLength: field.key === 'name' ? 80 : 200,
                },
              }}
            />
          ))}
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" size="large" disabled={busy} fullWidth>
          {busy ? 'Criando…' : 'Criar administrador'}
        </Button>
      </Stack>
    </Box>
  );
}
