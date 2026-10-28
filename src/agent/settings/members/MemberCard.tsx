import { Bot, UserRound, Wrench } from 'lucide-react';
import type { RosterAgent, Salary, Skill } from '../../adminTypes';
import { cn } from '../../ui/cn';
import { RowActions } from '../../ui/Settings';
import { phone, roleLabel, runtimeLabel } from '../directory/labels';
import { MemberAvatar } from './MemberAvatar';
import { salaryLabel, skillIdsOf, statusOf } from './format';

const TONE = { online: 'bg-n-teal-9', busy: 'bg-n-amber-9', offline: 'bg-n-slate-8' };

interface Props {
  agent: RosterAgent;
  skills: Skill[];
  salary: Salary | undefined;
  you: boolean;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}

/** A member of the organization: who it is, its role, kind, status, monthly cost and skills. */
export function MemberCard({ agent, skills, salary, you, selected, onOpen, onEdit, onDelete }: Props) {
  const status = statusOf(agent);
  const own = skillIdsOf(agent)
    .map((id) => skills.find((s) => s.id === id))
    .filter((s): s is Skill => Boolean(s));
  const tools = new Set(own.flatMap((s) => s.tools)).size;
  const contact =
    agent.kind === 'human'
      ? [agent.user_email, phone(agent.whatsapp_jid)].filter(Boolean).join(' · ')
      : [runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ');
  return (
    <article
      aria-label={agent.name}
      className={cn(
        'flex flex-col gap-3 rounded-xl bg-n-solid-2 p-4 outline outline-1 -outline-offset-1 transition-colors',
        selected ? 'outline-n-brand' : 'outline-n-weak hover:outline-n-slate-6',
        !agent.active && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={48} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Abrir ${agent.name}`}
            className="block max-w-full truncate text-start font-medium text-n-slate-12 hover:underline"
          >
            {agent.name}
            {you && <span className="text-n-slate-10"> (você)</span>}
          </button>
          <span className="block truncate text-xs text-n-slate-11">{agent.profile_name ?? '—'}</span>
          {agent.role && roleLabel(agent.role) !== agent.profile_name && (
            <span className="block text-xs text-n-slate-11">{roleLabel(agent.role)}</span>
          )}
        </div>
        <RowActions labelFor={agent.name} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5',
            agent.kind === 'ai' ? 'bg-n-iris-9/15 text-n-slate-12' : 'bg-n-slate-4 text-n-slate-12',
          )}
        >
          {agent.kind === 'ai' ? <Bot size={12} /> : <UserRound size={12} />}
          {agent.kind === 'ai' ? 'IA' : 'Pessoa'}
        </span>
        <span className="inline-flex items-center gap-1 text-n-slate-11">
          <span className={cn('size-2 rounded-full', TONE[status.tone])} aria-hidden />
          {status.label}
        </span>
        <span className="ms-auto font-medium text-n-slate-12" title="Salário digital">
          {salaryLabel(agent, salary)}
        </span>
      </div>
      {contact && <p className="truncate text-xs break-all text-n-slate-11">{contact}</p>}
      {(own.length > 0 || agent.credential_count > 0) && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {own.slice(0, 3).map((s) => (
            <span key={s.id} className="rounded-md bg-n-alpha-2 px-1.5 py-0.5 text-n-slate-11">
              {s.name}
            </span>
          ))}
          {own.length > 3 && <span className="text-n-slate-10">+{own.length - 3}</span>}
          {tools > 0 && (
            <span className="ms-auto inline-flex items-center gap-1 text-n-slate-10" title="Ferramentas">
              <Wrench size={12} /> {tools}
            </span>
          )}
          {agent.credential_count > 0 && (
            <span className="block w-full text-n-slate-10">
              {agent.credential_count} credencia{agent.credential_count === 1 ? 'l' : 'is'}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
