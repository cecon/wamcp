import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { http, setCsrf } from './api';
import type { User } from './types';
import { Workspace } from './Workspace';
import { Button } from './ui/Button';
import { MfaStep } from './auth/MfaStep';
import { authError, type LoginResult, type Me } from './auth/authError';
import { useTheme } from './theme/theme';

export default function AgentApp() {
  useTheme();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    http<Me>('/auth/me')
      .then((me) => {
        setCsrf(me.csrf);
        setUser(me.user);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return <div className="flex h-full items-center justify-center text-n-slate-11">Carregando…</div>;
  if (!user)
    return (
      <Login
        onLogin={(me) => {
          setCsrf(me.csrf);
          setUser(me.user);
        }}
      />
    );
  return (
    <Workspace
      user={user}
      onUser={setUser}
      onLogout={() => {
        setCsrf(null);
        setUser(null);
      }}
    />
  );
}

/** Chatwoot auth card: logo, title, form with labelled fields and a full-width blue button. */
function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [challenge, setChallenge] = useState<string | null>(null);
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-n-background px-4 py-12">
      {challenge ? (
        <MfaStep
          token={challenge}
          onLogin={onLogin}
          onRestart={(message) => {
            setChallenge(null);
            setPassword('');
            setError(message);
          }}
        />
      ) : (
        <form
          className="w-full max-w-md bg-n-solid-1 p-8 sm:rounded-lg sm:p-11 sm:shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            http<LoginResult>('/auth/login', 'POST', { email, password })
              .then((result) => ('mfa_required' in result ? setChallenge(result.mfa_token) : onLogin(result)))
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
                onChange={(e) => setEmail(e.target.value)}
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
      )}
    </main>
  );
}
