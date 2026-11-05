import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';

// third-party
import { Keyboard, Monitor, Moon, Power, Sun, UserCog, Workflow } from 'lucide-react';

import type { Availability, User } from '../types';
import type { Route } from '../route';
import { Avatar } from '../ui/Avatar';
import { THEME_LABEL, useTheme, type ThemeMode } from '../theme/theme';

const THEME_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

const AVAILABILITY: { value: Availability; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: 'var(--color-n-teal-9)' },
  { value: 'busy', label: 'Ocupado', color: 'var(--color-n-amber-9)' },
  { value: 'offline', label: 'Offline', color: 'var(--color-n-slate-9)' },
];

const heading = { px: 1, pt: 0.5, fontSize: 12, fontWeight: 500, color: 'text.disabled' } as const;

interface Props {
  user: User;
  online: boolean;
  onAvailability: (value: Availability) => void;
  onLogout: () => void;
  onNavigate?: (route: Route) => void;
  onShortcuts?: () => void;
}

/** Chatwoot SidebarProfileMenu: avatar + name/email, opening availability and logout. */
export function ProfileMenu({ user, online, onAvailability, onLogout, onNavigate, onShortcuts }: Props) {
  const [theme, setTheme] = useTheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <Box
      sx={{
        borderTop: 1,
        borderColor: 'divider',
        px: 0.5,
        py: 0.75,
        boxShadow: '0 -2px 4px rgba(27, 28, 29, 0.02)',
      }}
    >
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-label="Perfil"
        sx={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          gap: 1,
          borderRadius: 1,
          p: 0.5,
          textAlign: 'left',
          justifyContent: 'flex-start',
          '&:hover': { bgcolor: 'var(--color-n-alpha-1)' },
        }}
      >
        <Avatar name={user.name} size={32} status={user.availability} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ display: 'block', fontSize: 14, lineHeight: '16px', fontWeight: 500 }}>
            {user.name}
          </Typography>
          <Typography noWrap sx={{ display: 'block', fontSize: 12, color: 'var(--color-n-slate-11)' }}>
            {user.email}
          </Typography>
        </Box>
        <Box
          component="span"
          title={online ? 'Tempo real conectado' : 'Reconectando…'}
          sx={{
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRadius: '50%',
            bgcolor: online ? 'var(--color-n-teal-9)' : 'var(--color-n-ruby-9)',
          }}
        />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 256 } } }}
      >
        <Box component="li" role="presentation" sx={heading}>
          Disponibilidade
        </Box>
        {AVAILABILITY.map((a) => (
          <MenuItem
            key={a.value}
            onClick={() => {
              onAvailability(a.value);
              close();
            }}
          >
            <ListItemIcon>
              <Box component="span" sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: a.color }} />
            </ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
        <Divider sx={{ my: 1 }} />
        <Box component="li" role="presentation" sx={heading}>
          Aparência
        </Box>
        {(Object.keys(THEME_LABEL) as ThemeMode[]).map((mode) => {
          const Icon = THEME_ICON[mode];
          return (
            <MenuItem
              key={mode}
              className={theme === mode ? 'bg-n-alpha-2' : undefined}
              sx={{ bgcolor: theme === mode ? 'var(--color-n-alpha-2)' : undefined }}
              onClick={() => setTheme(mode)}
            >
              <ListItemIcon>
                <Icon size={16} />
              </ListItemIcon>
              <ListItemText>{THEME_LABEL[mode]}</ListItemText>
            </MenuItem>
          );
        })}
        <Divider sx={{ my: 1 }} />
        {onShortcuts && (
          <MenuItem
            onClick={() => {
              close();
              onShortcuts();
            }}
          >
            <ListItemIcon>
              <Keyboard size={16} />
            </ListItemIcon>
            <ListItemText>Atalhos de teclado</ListItemText>
          </MenuItem>
        )}
        {onNavigate && (
          <MenuItem
            onClick={() => {
              close();
              onNavigate({ page: 'profile' });
            }}
          >
            <ListItemIcon>
              <UserCog size={16} />
            </ListItemIcon>
            <ListItemText>Configurações do perfil</ListItemText>
          </MenuItem>
        )}
        {onNavigate && user.role !== 'administrator' && (
          <MenuItem
            onClick={() => {
              close();
              onNavigate({ page: 'settings', section: 'macros' });
            }}
          >
            <ListItemIcon>
              <Workflow size={16} />
            </ListItemIcon>
            <ListItemText>Macros</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={onLogout}>
          <ListItemIcon>
            <Power size={16} />
          </ListItemIcon>
          <ListItemText>Sair</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
