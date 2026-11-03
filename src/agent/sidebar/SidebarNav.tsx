// third-party
import {
  AtSign,
  Bolt,
  Bot,
  ChartSpline,
  Contact,
  Folder,
  Inbox as InboxIcon,
  Mailbox,
  MessageCircle,
  MessageCircleDashed,
  Tag,
  Users,
  UsersRound,
} from 'lucide-react';

// material-ui
import Box from '@mui/material/Box';

import type { Catalog, ConversationType, CustomFilter, User } from '../types';
import { CONVERSATION_TYPE_LABEL } from '../labels';
import type { Route } from '../route';
import { canManageContacts, canViewReports } from '../permissions';
import { isDesktop } from '../desktop/tauri';
import { SidebarGroup, SidebarLeaf, SidebarSeparator } from './SidebarParts';
import { REPORTS, SETTINGS } from './navItems';

const TYPES: { type: ConversationType; icon: typeof Bolt }[] = [
  { type: 'mentions', icon: AtSign },
  { type: 'unattended', icon: MessageCircleDashed },
  { type: 'participating', icon: UsersRound },
];

export type SidebarGroupId = 'conversations' | 'reports' | 'settings' | null;

interface Props {
  user: User;
  catalog: Catalog;
  views: CustomFilter[];
  route: Route;
  unread: number;
  expanded: SidebarGroupId;
  onExpand: (group: SidebarGroupId) => void;
  onOpen: (group: SidebarGroupId, target: Route) => void;
  onNavigate: (route: Route) => void;
}

/** Árvore de navegação da sidebar (Chatwoot SidebarGroup): grupos expansíveis, pastas, times, canais e etiquetas. */
export function SidebarNav({
  user,
  catalog,
  views,
  route,
  unread,
  expanded,
  onExpand,
  onOpen,
  onNavigate,
}: Props) {
  const isAdmin = user.role === 'administrator';
  const conv = route.page === 'conversations' ? route : null;
  const allActive = Boolean(
    conv && !conv.inboxId && !conv.teamId && !conv.label && !conv.conversationType && !conv.filters,
  );
  const dot = (color: string) => (
    <Box component="span" sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: 0.5, bgcolor: color }} />
  );

  return (
    <Box
      component="nav"
      sx={{ minHeight: 0, flexGrow: 1, overflowX: 'hidden', overflowY: 'auto', px: 1, pb: 2.5 }}
    >
      <Box
        component="ul"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, m: 0, p: 0, listStyle: 'none' }}
      >
        <SidebarGroup
          icon={InboxIcon}
          label="Caixa de entrada"
          count={unread}
          active={route.page === 'notifications'}
          parentOfActive={false}
          onClick={() => onOpen(null, { page: 'notifications' })}
        />
        <SidebarGroup
          icon={MessageCircle}
          label="Conversas"
          active={false}
          parentOfActive={route.page === 'conversations'}
          expanded={expanded === 'conversations'}
          onClick={() =>
            expanded === 'conversations' ? onExpand(null) : onOpen('conversations', { page: 'conversations' })
          }
        >
          <SidebarLeaf
            label="Todas as conversas"
            icon={<InboxIcon size={16} />}
            active={allActive}
            onClick={() => onNavigate({ page: 'conversations' })}
          />
          {TYPES.map(({ type, icon: Icon }) => (
            <SidebarLeaf
              key={type}
              label={CONVERSATION_TYPE_LABEL[type]}
              icon={<Icon size={16} />}
              active={conv?.conversationType === type}
              onClick={() => onNavigate({ page: 'conversations', conversationType: type })}
            />
          ))}
          {views.length > 0 && <SidebarSeparator icon={Folder} label="Pastas" />}
          {views.map((v) => (
            <SidebarLeaf
              key={`v${v.id}`}
              label={v.name}
              active={conv?.viewId === v.id}
              onClick={() =>
                onNavigate({ page: 'conversations', viewId: v.id, filters: v.query?.payload || [] })
              }
            />
          ))}
          {catalog.teams.length > 0 && <SidebarSeparator icon={Users} label="Times" />}
          {catalog.teams.map((t) => (
            <SidebarLeaf
              key={`t${t.id}`}
              nested
              label={t.name}
              active={conv?.teamId === t.id}
              onClick={() => onNavigate({ page: 'conversations', teamId: t.id })}
            />
          ))}
          {catalog.inboxes.length > 0 && <SidebarSeparator icon={Mailbox} label="Canais" />}
          {catalog.inboxes.map((i) => (
            <SidebarLeaf
              key={`i${i.id}`}
              nested
              label={i.name}
              icon={<MessageCircle size={16} color="var(--color-n-teal-10)" />}
              active={conv?.inboxId === i.id}
              onClick={() => onNavigate({ page: 'conversations', inboxId: i.id })}
            />
          ))}
          {catalog.labels.length > 0 && <SidebarSeparator icon={Tag} label="Etiquetas" />}
          {catalog.labels.map((l) => (
            <SidebarLeaf
              key={`l${l.id}`}
              nested
              label={l.title}
              icon={dot(l.color)}
              active={conv?.label === l.title}
              onClick={() => onNavigate({ page: 'conversations', label: l.title })}
            />
          ))}
        </SidebarGroup>
        <SidebarGroup
          icon={Bot}
          label="Agentes"
          active={route.page === 'agent_chat'}
          parentOfActive={false}
          onClick={() => onOpen(null, { page: 'agent_chat' })}
        />
        {canManageContacts(user) && (
          <SidebarGroup
            icon={Contact}
            label="Contatos"
            active={route.page === 'contacts'}
            parentOfActive={false}
            onClick={() => onOpen(null, { page: 'contacts' })}
          />
        )}
        {canViewReports(user) && (
          <SidebarGroup
            icon={ChartSpline}
            label="Relatórios"
            active={false}
            parentOfActive={route.page === 'reports'}
            expanded={expanded === 'reports'}
            onClick={() =>
              expanded === 'reports'
                ? onExpand(null)
                : onOpen('reports', { page: 'reports', section: 'overview' })
            }
          >
            {REPORTS.map(({ section, label }) => (
              <SidebarLeaf
                key={section}
                label={label}
                active={route.page === 'reports' && (route.section || 'overview') === section}
                onClick={() => onNavigate({ page: 'reports', section })}
              />
            ))}
          </SidebarGroup>
        )}
        {isAdmin && (
          <SidebarGroup
            icon={Bolt}
            label="Configurações"
            active={false}
            parentOfActive={route.page === 'settings'}
            expanded={expanded === 'settings'}
            onClick={() =>
              expanded === 'settings'
                ? onExpand(null)
                : onOpen('settings', { page: 'settings', section: 'agents' })
            }
          >
            {SETTINGS.filter((s) => !s.desktop || isDesktop()).map(({ section, label, icon: Icon }) => (
              <SidebarLeaf
                key={section}
                label={label}
                icon={<Icon size={16} />}
                active={
                  route.page === 'settings' &&
                  (route.section === section || (section === 'inboxes' && route.section === 'connections'))
                }
                onClick={() => onNavigate({ page: 'settings', section })}
              />
            ))}
          </SidebarGroup>
        )}
      </Box>
    </Box>
  );
}
