import {
  AlertTriangle,
  BellOff,
  MessageCircle,
  SignalHigh,
  SignalLow,
  SignalMedium,
  UserRound,
} from 'lucide-react';
import { timeAgo } from '../api';
import type { Conversation, Label } from '../types';
import { SlaBadge } from '../sla/SlaBadge';
import { Avatar } from '../ui/Avatar';
import { cn } from '../ui/cn';
import { plainMentions } from './mentions';

const PRIORITY = {
  urgent: <AlertTriangle size={14} className="text-n-ruby-11" aria-label="Prioridade urgente" />,
  high: <SignalHigh size={14} className="text-n-amber-11" aria-label="Prioridade alta" />,
  medium: <SignalMedium size={14} className="text-n-amber-11" aria-label="Prioridade média" />,
  low: <SignalLow size={14} className="text-n-slate-10" aria-label="Prioridade baixa" />,
};

interface Props {
  conversation: Conversation;
  labels: Label[];
  selected: boolean;
  onSelect: () => void;
  /** Bulk selection checkbox over the avatar (on hover, always while selecting). */
  checked?: boolean;
  selecting?: boolean;
  onCheck?: (checked: boolean) => void;
}

/** Chatwoot ConversationCard (condensed): meta row, name, preview, labels; time and unread at top-right. */
export function ConversationCard({
  conversation: c,
  labels,
  selected,
  onSelect,
  checked = false,
  selecting = false,
  onCheck,
}: Props) {
  const unread = c.unread_count > 0;
  const hasSla = c.sla_status === 'missed' || c.sla_status === 'active';
  const name = c.contact_name || c.contact_phone || 'Contato';
  const color = (title: string) => labels.find((l) => l.title === title)?.color || '#8B8D98';
  return (
    <li className="group relative">
      {onCheck && (
        <input
          type="checkbox"
          aria-label={`Selecionar conversa #${c.display_id}`}
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className={cn(
            'absolute top-10 left-5 z-10 size-4 cursor-pointer',
            selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'relative flex w-full items-start border-b border-n-slate-3 px-3 text-left',
          selected ? 'bg-n-slate-2' : 'hover:bg-n-alpha-1',
        )}
      >
        <Avatar name={name} src={c.contact_avatar_url} size={32} className="mt-8" />
        <span className="min-w-0 flex-1 py-3">
          <span className="ml-2 flex items-center gap-1 pr-16 text-n-slate-11">
            <MessageCircle size={14} className="shrink-0 text-n-teal-10" />
            <span className="text-body-main truncate">{c.inbox_name}</span>
            {c.assignee_name && (
              <span className="ml-1 flex min-w-0 items-center gap-0.5 text-xs font-medium">
                <UserRound size={12} className="shrink-0" />
                <span className="truncate">{c.assignee_name}</span>
              </span>
            )}
            {c.muted ? (
              <BellOff
                size={14}
                className="ml-auto shrink-0 text-n-slate-10"
                aria-label="Conversa silenciada"
              />
            ) : null}
            {c.priority && (
              <span className={cn('shrink-0', !c.muted && 'ml-auto')}>{PRIORITY[c.priority]}</span>
            )}
          </span>
          <span
            className={cn(
              'mx-2 block truncate pt-0.5 pr-16 text-sm text-n-slate-12',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {name}
          </span>
          <span
            className={cn(
              'mx-2 block h-6 truncate text-sm leading-6',
              unread ? 'font-medium text-n-slate-12' : 'text-n-slate-11',
            )}
          >
            {c.last_message ? plainMentions(c.last_message) : '—'}
          </span>
          {(c.labels.length > 0 || hasSla) && (
            <span className="mx-2 mt-0.5 flex h-6 items-center gap-2.5 overflow-hidden">
              <SlaBadge status={c.sla_status} />
              {c.labels.map((l) => (
                <span key={l} className="flex shrink-0 items-center gap-1.5 text-sm text-n-slate-10">
                  <span className="size-1.5 rounded-full" style={{ background: color(l) }} />
                  {l}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="absolute top-8 right-3 flex flex-col items-end">
          <span className="text-xxs leading-4 text-n-slate-11">{timeAgo(c.last_activity_at)}</span>
          {unread && (
            <span className="mt-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-n-teal-9 px-1 text-xxs font-medium text-white">
              {c.unread_count > 9 ? '9+' : c.unread_count}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
