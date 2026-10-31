import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router';
import { http, setCsrf } from './api';
import type { User } from './types';
import { Workspace } from './Workspace';
import type { Me } from './auth/authError';
import { useTheme } from './theme/theme';
import { routerBase } from './navigation/routes';

// Login/MFA usam o C3Theme (AuthLayout + campos do MUI): entram em chunk próprio para a tela inicial não pesar.
const Login = lazy(() => import('./auth/Login').then((module) => ({ default: module.Login })));

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
  const content = loading ? (
    <div className="flex h-full items-center justify-center text-n-slate-11">Carregando…</div>
  ) : !user ? (
    <Suspense
      fallback={<div className="flex h-full items-center justify-center text-n-slate-11">Carregando…</div>}
    >
      <Login
        onLogin={(me) => {
          setCsrf(me.csrf);
          setUser(me.user);
        }}
      />
    </Suspense>
  ) : (
    <Workspace
      user={user}
      onUser={setUser}
      onLogout={() => {
        setCsrf(null);
        setUser(null);
      }}
    />
  );
  // A rota vive na URL (deep link, F5 e voltar/avançar); `basename` acompanha a base do build (/app/).
  return <BrowserRouter basename={routerBase()}>{content}</BrowserRouter>;
}
