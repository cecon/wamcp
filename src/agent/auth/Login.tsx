import { useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { AuthLayout } from '@c3theme/ui';

import { firstRun, http } from '../api';
import C3Provider from '../c3/C3Provider';
import { MfaStep } from './MfaStep';
import { Bootstrap } from './Bootstrap';
import { authError, type LoginResult, type Me } from './authError';

/** GET /api/helpdesk/status: no administrator yet, and whether this request comes from this computer. */
export interface FirstRunStatus {
  needsBootstrap: boolean;
  local: boolean;
}

const ASIDE = (
  <>
    <Typography variant="h2" color="inherit">
      Atendimento no WhatsApp
    </Typography>
    <Typography variant="body1" sx={{ mt: 1, maxWidth: 420, opacity: 0.9 }}>
      Converse com seus clientes, organize filas e acompanhe o time em um só lugar.
    </Typography>
  </>
);

/** Autenticação no C3Theme (lote 8): login, verificação em duas etapas e primeiro acesso no `AuthLayout`. */
export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [setup, setSetup] = useState<FirstRunStatus | null>(null),
    [challenge, setChallenge] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [email, setEmail] = useState('');
  useEffect(() => {
    let live = true;
    // Without an answer the usual login stays available.
    firstRun<FirstRunStatus>('/status')
      .then((status) => live && setSetup(status))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const signedIn = (result: LoginResult) =>
    'mfa_required' in result ? setChallenge(result.mfa_token) : onLogin(result);

  let content;
  if (challenge)
    content = (
      <MfaStep
        token={challenge}
        onLogin={onLogin}
        onRestart={(message) => {
          setChallenge(null);
          setNotice(message);
        }}
      />
    );
  else if (setup?.needsBootstrap && setup.local)
    content = (
      <Bootstrap
        onSignedIn={signedIn}
        onExists={(message) => {
          setNotice(message);
          setSetup({ ...setup, needsBootstrap: false });
        }}
      />
    );
  else if (setup?.needsBootstrap)
    content = (
      <Stack spacing={2} role="status">
        <Typography variant="h4" component="h1">
          Primeiro acesso
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Abra o WA MCP no computador onde ele está instalado para criar o primeiro administrador.
        </Typography>
      </Stack>
    );
  else content = <PasswordStep email={email} onEmail={setEmail} initialError={notice} onResult={signedIn} />;

  return (
    <C3Provider>
      <AuthLayout aside={ASIDE}>{content}</AuthLayout>
    </C3Provider>
  );
}

interface PasswordProps {
  email: string;
  onEmail: (email: string) => void;
  initialError: string;
  onResult: (result: LoginResult) => void;
}

/** E-mail e senha; o e-mail sobrevive a um passo de dois fatores cancelado ou expirado. */
function PasswordStep({ email, onEmail, initialError, onResult }: PasswordProps) {
  const [password, setPassword] = useState(''),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        http<LoginResult>('/auth/login', 'POST', { email, password })
          .then(onResult)
          .catch((err: unknown) => setError(authError(err)))
          .finally(() => setBusy(false));
      }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h4" component="h1">
            Entrar no Atendimento
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Use a conta de agente criada pelo administrador.
          </Typography>
        </Box>
        <TextField
          label="E-mail"
          type="email"
          size="small"
          autoFocus
          value={email}
          placeholder="voce@empresa.com"
          onChange={(event) => onEmail(event.target.value)}
          slotProps={{ htmlInput: { required: true, autoComplete: 'email' } }}
        />
        <TextField
          label="Senha"
          type="password"
          size="small"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          slotProps={{ htmlInput: { required: true, autoComplete: 'current-password' } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" size="large" disabled={busy} fullWidth>
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
      </Stack>
    </Box>
  );
}
