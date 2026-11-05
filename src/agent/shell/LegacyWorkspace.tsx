import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';

import type { Catalog, CustomFilter, User } from '../types';
import type { Route } from '../route';
import { Sidebar } from '../sidebar/Sidebar';

interface Props {
  user: User;
  catalog: Catalog;
  views: CustomFilter[];
  route: Route;
  unread: number;
  online: boolean;
  onNavigate: (route: Route) => void;
  onAvailability: (value: User['availability']) => void;
  onLogout: () => void;
  onShortcuts: () => void;
  bell?: ReactNode;
  children: ReactNode;
}

/**
 * Shell antigo (sidebar prÃ³pria), mantido atrÃ¡s de `?shelllegacy` para comparaÃ§Ã£o/rollback. O padrÃ£o agora Ã© o
 * `AppLayout` do C3Theme em `C3Workspace`; este mÃ³dulo fica em chunk lazy para o shell novo nÃ£o carregar o cÃ³digo antigo.
 */
export default function LegacyWorkspace({
  user,
  catalog,
  views,
  route,
  unread,
  online,
  onNavigate,
  onAvailability,
  onLogout,
  onShortcuts,
  bell,
  children,
}: Props) {
  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', color: 'text.primary' }}>
      <Sidebar
        user={user}
        catalog={catalog}
        views={views}
        route={route}
        unread={unread}
        online={online}
        onNavigate={onNavigate}
        onAvailability={onAvailability}
        onLogout={onLogout}
        onShortcuts={onShortcuts}
        bell={bell}
      />
      <Box
        component="main"
        sx={{
          display: 'flex',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
