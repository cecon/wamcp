import { useState, type ComponentType, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';

// third-party
import { Chart2, Message2, People, Setting2, Sms, User as UserIcon } from 'iconsax-reactjs';
import { Search, TextSearch } from 'lucide-react';

// C3Theme
import { AppLayout, ColorModeButton, FillHeight, SettingsButton } from '@c3theme/ui';
import type { NavGroup, NavItem } from '@c3theme/ui';

import type { Catalog, ConversationType, CustomFilter, User } from '../types';
import type { Route } from '../route';
import { CONVERSATION_TYPE_LABEL } from '../labels';
import { canManageContacts, canViewReports } from '../permissions';
import { REPORTS, SETTINGS } from '../sidebar/navItems';
import { ProfileMenu } from '../sidebar/ProfileMenu';
import { routeToPath } from '../navigation/routes';
import { isDesktop } from '../desktop/tauri';

/** Ícone do lucide no formato que o `NavItem` do pacote espera (ele chama com `size` e `variant`). */
function navIcon(Icon: ComponentType<{ size?: number | string }>) {
  return function NavIcon({ size = 20 }: { size?: number }) {
    return <Icon size={size} />;
  };
}

const TYPES: ConversationType[] = ['mentions', 'unattended', 'participating'];

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
  /** Sino de notificações montado pela tela (precisa do realtime). */
  bell?: ReactNode;
  children: ReactNode;
}

/**
 * Shell novo do app sobre o `AppLayout` do C3Theme. Fica atrás de `?c3shell` enquanto a troca do padrão não é
 * aprovada: o menu, a busca, o sino e o menu do perfil são os mesmos de antes, mas a moldura, o claro/escuro, a
 * tipografia e o comportamento responsivo passam a ser do pacote.
 */
export function C3Shell({
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
  const [q, setQ] = useState('');
  const to = (target: Route) => routeToPath(target);
  const isAdmin = user.role === 'administrator';

  const conversationItems: NavItem[] = [
    { id: 'all', title: 'Todas as conversas', url: to({ page: 'conversations' }) },
    ...TYPES.map((type) => ({
      id: `type-${type}`,
      title: CONVERSATION_TYPE_LABEL[type],
      url: to({ page: 'conversations', conversationType: type }),
    })),
    ...views.map((view) => ({
      id: `view-${view.id}`,
      title: view.name,
      url: to({ page: 'conversations', viewId: view.id, filters: view.query?.payload || [] }),
    })),
    ...catalog.teams.map((team) => ({
      id: `team-${team.id}`,
      title: team.name,
      url: to({ page: 'conversations', teamId: team.id }),
    })),
    ...catalog.inboxes.map((inbox) => ({
      id: `inbox-${inbox.id}`,
      title: inbox.name,
      url: to({ page: 'conversations', inboxId: inbox.id }),
    })),
    ...catalog.labels.map((label) => ({
      id: `label-${label.id}`,
      title: label.title,
      url: to({ page: 'conversations', label: label.title }),
    })),
  ];

  const groups: NavGroup[] = [
    {
      id: 'atendimento',
      title: 'Atendimento',
      items: [
        {
          id: 'notifications',
          title: 'Caixa de entrada',
          icon: Sms,
          url: to({ page: 'notifications' }),
          badge: unread > 0 ? unread : undefined,
        },
        { id: 'conversations', title: 'Conversas', icon: Message2, children: conversationItems },
        { id: 'agent-chat', title: 'Agentes', icon: UserIcon, url: to({ page: 'agent_chat' }) },
        ...(canManageContacts(user)
          ? [{ id: 'contacts', title: 'Contatos', icon: People, url: to({ page: 'contacts' }) }]
          : []),
      ],
    },
    ...(canViewReports(user)
      ? [
          {
            id: 'reports',
            title: 'Relatórios',
            items: [
              {
                id: 'reports-group',
                title: 'Relatórios',
                icon: Chart2,
                children: REPORTS.map((r) => ({
                  id: `report-${r.section}`,
                  title: r.label,
                  url: to({ page: 'reports', section: r.section }),
                })),
              },
            ],
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            id: 'sistema',
            title: 'Sistema',
            items: [
              {
                id: 'settings-group',
                title: 'Configurações',
                icon: Setting2,
                children: SETTINGS.filter((s) => !s.desktop || isDesktop()).map((s) => ({
                  id: `settings-${s.section}`,
                  title: s.label,
                  icon: navIcon(s.icon),
                  url: to({ page: 'settings', section: s.section }),
                })),
              },
            ],
          },
        ]
      : []),
  ];

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate({ page: 'conversations', q: q.trim() || undefined });
        }}
        sx={{ display: 'flex', minWidth: 0 }}
      >
        <OutlinedInput
          size="small"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Pesquisar…"
          startAdornment={
            <InputAdornment position="start">
              <Search size={16} />
            </InputAdornment>
          }
          slotProps={{ input: { 'aria-label': 'Pesquisar conversas' } }}
          sx={{ width: { xs: 120, sm: 200, md: 240 } }}
        />
      </Box>
      <IconButton
        aria-label="Pesquisa global"
        title="Pesquisa global (Ctrl+K)"
        onClick={() => onNavigate({ page: 'search' })}
      >
        <TextSearch size={18} />
      </IconButton>
      {bell}
      <ColorModeButton />
      <SettingsButton />
    </Box>
  );

  const fillHeight = route.page === 'conversations' || route.page === 'agent_chat';

  return (
    <AppLayout
      menu={groups}
      header={header}
      breadcrumbs={false}
      drawerFooter={
        <ProfileMenu
          user={user}
          online={online}
          onAvailability={onAvailability}
          onLogout={onLogout}
          onNavigate={onNavigate}
          onShortcuts={onShortcuts}
        />
      }
    >
      {fillHeight ? (
        <FillHeight sx={{ bgcolor: 'background.paper' }}>{children}</FillHeight>
      ) : (
        <Box sx={{ bgcolor: 'background.paper', minHeight: '100%' }}>{children}</Box>
      )}
    </AppLayout>
  );
}
