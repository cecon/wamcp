import { useEffect, useState } from 'react';
import { http, setCsrf } from './api';
import type { User } from './types';
import { Workspace } from './Workspace';
import { Login } from './auth/Login';
import type { Me } from './auth/authError';
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
