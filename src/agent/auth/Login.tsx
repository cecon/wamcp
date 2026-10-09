import { useEffect, useState } from 'react';
import { MessageCircle, MonitorSmartphone } from 'lucide-react';
import { firstRun, http } from '../api';
import { Button } from '../ui/Button';
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
      <div className={CARD} role="status">
        <span className="mb-6 flex size-10 items-center justify-center rounded-xl bg-n-brand text-white">
          <MonitorSmartphone size={22} />
        </span>
        <h1 className="text-2xl font-semibold text-n-slate-12">Primeiro acesso</h1>
        <p className="mt-2 text-sm text-n-slate-11">
          Abra o WA MCP no computador onde ele está instalado para criar o primeiro administrador.
        </p>
      </div>
    );
  else content = <PasswordStep email={email} onEmail={setEmail} initialError={notice} onResult={signedIn} />;
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-n-background px-4 py-12">
      {content}
    </main>
  );
}

interface PasswordProps {
  email: string;
  onEmail: (email: string) => void;
  initialError: string;
  onResult: (result: LoginResult) => void;
}

/** E-mail and password; the e-mail survives a cancelled or expired two-factor step. */
function PasswordStep({ email, onEmail, initialError, onResult }: PasswordProps) {
  const [password, setPassword] = useState(''),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  return (
    <form
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        http<LoginResult>('/auth/login', 'POST', { email, password })
          .then(onResult)
          .catch((err: unknown) => setError(authError(err)))
          .finally(() => setBusy(false));
      }}
    >
      <span className="mb-6 flex size-10 items-center justify-center rounded-xl bg-n-brand text-white">
        <MessageCircle size={22} />
      </span>
      <h1 className="text-2xl font-semibold text-n-slate-12">Entrar no Atendimento</h1>
      <p className="mt-2 text-sm text-n-slate-11">Use a conta de agente criada pelo administrador.</p>
      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="field-label">E-mail</span>
          <input
            className="field"
            type="email"
            value={email}
            placeholder="voce@empresa.com"
            onChange={(e) => onEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="block">
          <span className="field-label">Senha</span>
          <input
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="text-sm text-n-ruby-11" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="md"
          className="w-full"
          disabled={busy}
          label={busy ? 'Entrando…' : 'Entrar'}
        />
      </div>
    </form>
  );
}
