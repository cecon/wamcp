import { useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { MessageCircle, Search, TextSearch } from 'lucide-react';

import type { Catalog, CustomFilter, User } from '../types';
import type { Route } from '../route';
import { ProfileMenu } from './ProfileMenu';
import { SidebarNav, type SidebarGroupId } from './SidebarNav';

interface Props {
  user: User;
  catalog: Catalog;
  views?: CustomFilter[];
  route: Route;
  unread: number;
  online: boolean;
  onNavigate: (route: Route) => void;
  onAvailability: (value: User['availability']) => void;
  onLogout: () => void;
  /** Notification bell shown next to the account name. */
  bell?: ReactNode;
  /** Opens the keyboard shortcuts help (profile menu). */
  onShortcuts?: () => void;
}

/** Chatwoot components-next/sidebar: account header, search, accordion nav and profile footer. */
export function Sidebar({
  user,
  catalog,
  views = [],
  route,
  unread,
  online,
  onNavigate,
  onAvailability,
  onLogout,
  bell,
  onShortcuts,
}: Props) {
  const [expanded, setExpanded] = useState<SidebarGroupId>(
    route.page === 'settings' || route.page === 'reports' ? route.page : 'conversations',
  );
  const [q, setQ] = useState('');
  const open = (group: SidebarGroupId, target: Route) => {
    setExpanded(group);
    onNavigate(target);
  };

  return (
    <Box
      component="aside"
      sx={{
        display: 'flex',
        height: '100%',
        width: 232,
        flexShrink: 0,
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'var(--color-n-background)',
        color: 'var(--color-n-slate-12)',
        fontSize: 14,
      }}
    >
      <Box sx={{ mt: 0.5, mb: 2, display: 'grid', gap: 1, pt: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1 }}>
          <Box
            sx={{
              display: 'flex',
              width: 24,
              height: 24,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 1,
              bgcolor: 'var(--color-n-brand)',
              color: '#fff',
            }}
          >
            <MessageCircle size={14} />
          </Box>
          <Box sx={{ height: 12, width: 1, bgcolor: 'var(--color-n-strong)' }} />
          <Typography noWrap sx={{ px: 1, fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>
            WA MCP
          </Typography>
          {bell}
        </Stack>
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            open('conversations', { page: 'conversations', q: q.trim() || undefined });
          }}
          sx={{ display: 'flex', gap: 1, px: 1, alignItems: 'center' }}
        >
          <OutlinedInput
            size="small"
            fullWidth
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Pesquisar…"
            startAdornment={
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            }
            slotProps={{ input: { 'aria-label': 'Pesquisar conversas' } }}
            sx={{
              height: 28,
              bgcolor: 'var(--color-n-button-color)',
              '& .MuiOutlinedInput-input': { py: 0.5, fontSize: 14 },
            }}
          />
          <IconButton
            type="button"
            size="small"
            aria-label="Pesquisa global"
            title="Pesquisa global (Ctrl+K)"
            aria-current={route.page === 'search' ? 'page' : undefined}
            onClick={() => open(null, { page: 'search' })}
            sx={{ flexShrink: 0, color: 'var(--color-n-slate-11)', border: 1, borderColor: 'divider' }}
          >
            <TextSearch size={16} />
          </IconButton>
        </Box>
      </Box>

      <SidebarNav
        user={user}
        catalog={catalog}
        views={views}
        route={route}
        unread={unread}
        expanded={expanded}
        onExpand={setExpanded}
        onOpen={open}
        onNavigate={onNavigate}
      />

      <Box
        sx={{
          pointerEvents: 'none',
          mt: -4,
          height: 32,
          background: 'linear-gradient(to top, var(--color-n-background), transparent)',
        }}
      />
      <ProfileMenu
        user={user}
        online={online}
        onAvailability={onAvailability}
        onLogout={onLogout}
        onNavigate={onNavigate}
        onShortcuts={onShortcuts}
      />
    </Box>
  );
}
