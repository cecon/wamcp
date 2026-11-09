import type { MouseEvent, ReactNode } from 'react';
import { useInRouterContext, useNavigate } from 'react-router';

// material-ui
import Link from '@mui/material/Link';

import { routeToPath, routerBase } from '../navigation/routes';

interface Props {
  agentId: number | null | undefined;
  children: ReactNode;
  /** Sem permissão para a página (só administradores), mostra só o nome. */
  enabled?: boolean;
}

const pathOf = (agentId: number) => routeToPath({ page: 'agent', agentId });

function RouterLink({ agentId, children }: { agentId: number; children: ReactNode }) {
  const navigate = useNavigate();
  const path = pathOf(agentId);
  const open = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    // Mantém as flags do shell (`?c3shell`, `?shelllegacy`) como `useRoute` faz.
    const current = new URLSearchParams(window.location.search);
    const [base, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    for (const key of ['c3shell', 'shelllegacy']) {
      const value = current.get(key);
      if (value !== null) params.set(key, value);
    }
    navigate(`${base}?${params.toString()}`);
  };
  return (
    <Link
      href={`${routerBase()}${path}`}
      onClick={open}
      underline="hover"
      color="inherit"
      sx={{ fontWeight: 'inherit' }}
    >
      {children}
    </Link>
  );
}

/** O nome de um agente de IA que abre a página dele, em qualquer tela. */
export function AgentLink({ agentId, children, enabled = true }: Props) {
  const routed = useInRouterContext();
  if (!agentId || !enabled) return <>{children}</>;
  if (routed) return <RouterLink agentId={agentId}>{children}</RouterLink>;
  return (
    <Link
      href={`${routerBase()}${pathOf(agentId)}`}
      underline="hover"
      color="inherit"
      sx={{ fontWeight: 'inherit' }}
    >
      {children}
    </Link>
  );
}
