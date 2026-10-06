import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { http, setCsrf } from './api';
import type { User } from './types';
import { Workspace } from './Workspace';

type Me = { user: User; csrf: string | null };

export default function AgentApp() {
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
  if (loading) return <div className="splash">Carregando…</div>;
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

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          http<Me>('/auth/login', 'POST', { email, password })
            .then(onLogin)
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        <span className="login-logo">
          <MessageCircle size={28} />
        </span>
        <h1>Atendimento</h1>
        <p>Entre com a conta de agente criada pelo administrador.</p>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
