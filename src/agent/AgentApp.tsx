import { lazy, Suspense, useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { BrowserRouter } from 'react-router';
import { http, setCsrf } from './api';
import type { User } from './types';
import { Workspace } from './Workspace';
import type { Me } from './auth/authError';
import { useTheme } from './theme/theme';
import { routerBase } from './navigation/routes';

/** Fallback do carregamento inicial e dos chunks (login/páginas). */
const Loading = () => (
  <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
    <Typography variant="body2" color="text.secondary">
      Carregando…
    </Typography>
  </Box>
);

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
    <Loading />
  ) : !user ? (
    <Suspense fallback={<Loading />}>
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
