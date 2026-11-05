import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError, http } from '../api';
import { authError, type Me } from './authError';

interface Props {
  token: string;
  onLogin: (me: Me) => void;
  /** Volta para e-mail e senha (desafio cancelado ou expirado). */
  onRestart: (message: string) => void;
}

/** Segundo passo do login no C3Theme (lote 7): código TOTP ou código de recuperação. */
export function MfaStep({ token, onLogin, onRestart }: Props) {
  const [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        http<Me>('/auth/mfa', 'POST', { mfa_token: token, code: code.trim() })
          .then(onLogin)
          .catch((err: unknown) => {
            // Expired challenges (5 minutes or 5 wrong codes) need the password again.
            if (err instanceof ApiError && err.status === 401 && /expirad/i.test(err.message))
              return onRestart(err.message);
            setError(authError(err));
            setCode('');
          })
          .finally(() => setBusy(false));
      }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h4" component="h1">
            Verificação em duas etapas
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Insira o código de 6 dígitos do aplicativo autenticador ou um dos seus códigos de recuperação.
          </Typography>
        </Box>
        <TextField
          label="Código de verificação"
          size="small"
          autoFocus
          value={code}
          placeholder="000000"
          onChange={(event) => setCode(event.target.value)}
          slotProps={{
            htmlInput: { required: true, autoComplete: 'one-time-code', maxLength: 20 },
            input: { sx: { fontFamily: 'monospace', letterSpacing: '0.15em' } },
          }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" size="large" disabled={busy || !code.trim()} fullWidth>
          {busy ? 'Verificando…' : 'Verificar'}
        </Button>
        <Button variant="text" color="secondary" fullWidth onClick={() => onRestart('')}>
          Cancelar e voltar para o login
        </Button>
      </Stack>
    </Box>
  );
}
