import { useState, type ReactNode } from 'react';
import {
  AtSign,
  Bolt,
  ChartSpline,
  Contact,
  Folder,
  Inbox as InboxIcon,
  Mailbox,
  MessageCircle,
  MessageCircleDashed,
  Search,
  Tag,
  TextSearch,
  Users,
  UsersRound,
} from 'lucide-react';
import type { Catalog, ConversationType, CustomFilter, User } from '../types';
import { CONVERSATION_TYPE_LABEL } from '../labels';
import type { Route } from '../route';
import { SidebarGroup, SidebarLeaf, SidebarSeparator } from './SidebarParts';
import { ProfileMenu } from './ProfileMenu';
import { REPORTS, SETTINGS } from './navItems';

const TYPES: { type: ConversationType; icon: typeof Bolt }[] = [
  { type: 'mentions', icon: AtSign },
  { type: 'unattended', icon: MessageCircleDashed },
  { type: 'participating', icon: UsersRound },
];
type Group = 'conversations' | 'reports' | 'settings' | null;

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
  const isAdmin = user.role === 'administrator';
  const [expanded, setExpanded] = useState<Group>(
    route.page === 'settings' || route.page === 'reports' ? route.page : 'conversations',
  );
  const [q, setQ] = useState('');
  const conv = route.page === 'conversations' ? route : null;
  const allActive = Boolean(
    conv && !conv.inboxId && !conv.teamId && !conv.label && !conv.conversationType && !conv.filters,
  );
  const open = (group: Group, target: Route) => {
    setExpanded(group);
    onNavigate(target);
  };
  const dot = (color: string) => (
    <span className="size-2 shrink-0 rounded-sm" style={{ background: color }} />
  );

  return (
    <aside className="flex h-full w-[200px] shrink-0 flex-col border-r border-n-weak bg-n-background text-sm">
      <div className="mt-1 mb-4 grid gap-2 pt-2">
        <div className="flex items-center gap-2 px-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-n-brand text-white">
            <MessageCircle size={14} />
          </span>
          <span className="h-3 w-px bg-n-strong" />
          <span className="truncate px-2 text-sm leading-5 font-medium text-n-slate-12">WA MCP</span>
          {bell}
        </div>
        <form
          className="flex gap-2 px-2"
          onSubmit={(e) => {
            e.preventDefault();
            open('conversations', { page: 'conversations', q: q.trim() || undefined });
          }}
        >
          <label className="flex h-7 w-full items-center gap-2 rounded-lg bg-n-button-color px-2 py-1 outline outline-1 -outline-offset-1 outline-n-weak">
            <Search size={16} className="shrink-0 text-n-slate-10" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar…"
              aria-label="Pesquisar conversas"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-n-slate-10"
            />
          </label>
          <button
            type="button"
            aria-label="Pesquisa global"
            title="Pesquisa global (Ctrl+K)"
            aria-current={route.page === 'search' ? 'page' : undefined}
            onClick={() => open(null, { page: 'search' })}
            className="grid size-7 shrink-0 place-content-center rounded-lg text-n-slate-11 outline outline-1 -outline-offset-1 outline-n-weak hover:bg-n-alpha-2"
          >
            <TextSearch size={16} />
          </button>
        </form>
      </div>

      <nav className="no-scrollbar grid min-h-0 flex-grow content-start gap-2 overflow-x-hidden overflow-y-auto px-2 pb-5">
        <ul className="flex flex-col gap-1">
          <SidebarGroup
            icon={InboxIcon}
            label="Caixa de entrada"
            count={unread}
            active={route.page === 'notifications'}
            parentOfActive={false}
            onClick={() => open(null, { page: 'notifications' })}
          />
          <SidebarGroup
            icon={MessageCircle}
            label="Conversas"
            active={false}
            parentOfActive={route.page === 'conversations'}
            expanded={expanded === 'conversations'}
            onClick={() =>
              expanded === 'conversations'
                ? setExpanded(null)
                : open('conversations', { page: 'conversations' })
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
                label={t.name}
                active={conv?.teamId === t.id}
                onClick={() => onNavigate({ page: 'conversations', teamId: t.id })}
              />
            ))}
            {catalog.inboxes.length > 0 && <SidebarSeparator icon={Mailbox} label="Canais" />}
            {catalog.inboxes.map((i) => (
              <SidebarLeaf
                key={`i${i.id}`}
                label={i.name}
                icon={<MessageCircle size={16} className="text-n-teal-10" />}
                active={conv?.inboxId === i.id}
                onClick={() => onNavigate({ page: 'conversations', inboxId: i.id })}
              />
            ))}
            {catalog.labels.length > 0 && <SidebarSeparator icon={Tag} label="Etiquetas" />}
            {catalog.labels.map((l) => (
              <SidebarLeaf
                key={`l${l.id}`}
                label={l.title}
                icon={dot(l.color)}
                active={conv?.label === l.title}
                onClick={() => onNavigate({ page: 'conversations', label: l.title })}
              />
            ))}
          </SidebarGroup>
          <SidebarGroup
            icon={Contact}
            label="Contatos"
            active={route.page === 'contacts'}
            parentOfActive={false}
            onClick={() => open(null, { page: 'contacts' })}
          />
          {isAdmin && (
            <SidebarGroup
              icon={ChartSpline}
              label="Relatórios"
              active={false}
              parentOfActive={route.page === 'reports'}
              expanded={expanded === 'reports'}
              onClick={() =>
                expanded === 'reports'
                  ? setExpanded(null)
                  : open('reports', { page: 'reports', section: 'overview' })
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
                  ? setExpanded(null)
                  : open('settings', { page: 'settings', section: 'agents' })
              }
            >
              {SETTINGS.map(({ section, label, icon: Icon }) => (
                <SidebarLeaf
                  key={section}
                  label={label}
                  icon={<Icon size={16} />}
                  active={route.page === 'settings' && route.section === section}
                  onClick={() => onNavigate({ page: 'settings', section })}
                />
              ))}
            </SidebarGroup>
          )}
        </ul>
      </nav>

      <div className="pointer-events-none -mt-8 h-8 bg-gradient-to-t from-n-background" />
      <ProfileMenu
        user={user}
        online={online}
        onAvailability={onAvailability}
        onLogout={onLogout}
        onNavigate={onNavigate}
        onShortcuts={onShortcuts}
      />
    </aside>
  );
}
