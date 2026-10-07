import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';
import { cn } from '../ui/cn';

/** Unread/count pill (Chatwoot SidebarUnreadBadge: 99+). */
export function CountPill({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-n-slate-4 px-1 text-xxs font-medium text-n-slate-12">
      {value > 99 ? '99+' : value}
    </span>
  );
}

interface GroupProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  parentOfActive: boolean;
  expanded?: boolean;
  count?: number;
  onClick: () => void;
  children?: ReactNode;
}

/** Top-level item (Chatwoot SidebarGroupHeader) with an optional expandable tree. */
export function SidebarGroup({
  icon: Icon,
  label,
  active,
  parentOfActive,
  expanded,
  count,
  onClick,
  children,
}: GroupProps) {
  const expandable = children !== undefined;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expandable ? expanded : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left',
          active
            ? 'bg-n-alpha-2 font-medium text-n-slate-12'
            : parentOfActive
              ? 'font-medium text-n-slate-12 hover:bg-n-alpha-2'
              : 'text-n-slate-11 hover:bg-n-alpha-2',
        )}
      >
        <Icon size={16} className="shrink-0" />
        <span className="flex-1 truncate">{label}</span>
        {count ? <CountPill value={count} /> : null}
        {expandable && (expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
      {expandable && expanded && <ul className="mt-1 flex flex-col">{children}</ul>}
    </li>
  );
}

interface LeafProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  count?: number;
}

/** Child item with the tree connector line (Chatwoot SidebarGroupLeaf). */
export function SidebarLeaf({ label, active, onClick, icon, count }: LeafProps) {
  return (
    <li className="relative ms-3 min-w-0 py-0.5 ps-2 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-n-slate-4 last:before:bottom-1/2">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm',
          active
            ? 'bg-n-alpha-2 text-n-slate-12'
            : 'text-n-slate-11 hover:bg-gradient-to-r hover:from-transparent hover:via-n-slate-3/70 hover:to-n-slate-3/70',
        )}
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {count ? <CountPill value={count} /> : null}
      </button>
    </li>
  );
}

/** Sub-group heading inside a group (Chatwoot SidebarGroupSeparator: Teams, Channels, Labels). */
export function SidebarSeparator({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <li className="relative ms-3 ps-2 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-n-slate-4">
      <span className="flex h-8 items-center gap-2 px-2 py-1.5 text-sm font-medium text-n-slate-10">
        <Icon size={16} /> {label}
      </span>
    </li>
  );
}
