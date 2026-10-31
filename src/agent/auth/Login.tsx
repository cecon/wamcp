import { useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { MonitorSmartphone } from 'lucide-react';

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

const CARD = 'w-full max-w-md bg-n-solid-1 p-8 sm:rounded-lg sm:p-11 sm:shadow-lg';

/** Chatwoot auth card; on the first run it creates the administrator (only on this computer). */
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

  // Primeiro acesso fica na moldura antiga até o Bootstrap migrar (ele tem cartão e regras próprias).
  if (!challenge && setup?.needsBootstrap) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center bg-n-background px-4 py-12">
        {setup.local ? (
          <Bootstrap
            onSignedIn={signedIn}
            onExists={(message) => {
              setNotice(message);
              setSetup({ ...setup, needsBootstrap: false });
            }}
          />
        ) : (
          <div className={CARD} role="status">
            <span className="mb-6 flex size-10 items-center justify-center rounded-xl bg-n-brand text-white">
              <MonitorSmartphone size={22} />
            </span>
            <h1 className="text-2xl font-semibold text-n-slate-12">Primeiro acesso</h1>
            <p className="mt-2 text-sm text-n-slate-11">
              Abra o WA MCP no computador onde ele está instalado para criar o primeiro administrador.
            </p>
          </div>
        )}
      </main>
    );
  }

  return (
    <C3Provider>
      <AuthLayout
        aside={
          <>
            <Typography variant="h2" color="inherit">
              Atendimento no WhatsApp
            </Typography>
            <Typography variant="body1" sx={{ mt: 1, maxWidth: 420, opacity: 0.9 }}>
              Converse com seus clientes, organize filas e acompanhe o time em um só lugar.
            </Typography>
          </>
        }
      >
        {challenge ? (
          <MfaStep
            token={challenge}
            onLogin={onLogin}
            onRestart={(message) => {
              setChallenge(null);
              setNotice(message);
            }}
          />
        ) : (
          <PasswordStep email={email} onEmail={setEmail} initialError={notice} onResult={signedIn} />
        )}
      </AuthLayout>
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
