import { ArrowRight, Bot, Inbox as InboxIcon, TriangleAlert, UserRound } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import type { Catalog } from '../../types';
import { useFetch } from '../../useFetch';
import { cn } from '../../ui/cn';
import { SettingsHeader, SettingsPage } from '../../ui/Settings';
import { useAction } from '../useAction';
import { roleLabel } from '../directory/labels';
import { MemberAvatar } from './MemberAvatar';
import { agentBody } from './format';
import { buildTree, warnings } from './tree';

interface Props {
  catalog: Catalog;
}

/**
 * "Organização": the hierarchy of people and AI agents (who answers to whom), which directs the
 * agentic flow: a coordinator delegates to the members below it, and each inbox goes to its AI agent.
 */
export function OrganizationPage({ catalog }: Props) {
  const { data, error, loading, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const roster = data || [];
  const below = buildTree(roster);
  const notes = warnings(roster);
  const byId = (id: number | null | undefined) => roster.find((a) => a.id === id);
  const chain = (agent: RosterAgent) => {
    const bosses: RosterAgent[] = [];
    let boss = byId(agent.supervisor_id);
    while (boss && !bosses.includes(boss) && boss.id !== agent.id) {
      bosses.push(boss);
      boss = byId(boss.supervisor_id);
    }
    return bosses;
  };

  return (
    <SettingsPage wide>
      <SettingsHeader
        title="Organização"
        description="Quem responde a quem. A hierarquia dirige o fluxo agêntico: o coordenador delega para quem está abaixo dele e pergunta às pessoas; os operadores executam. Cada caixa de entrada vai para o agente de IA que a atende."
        count={`${roster.length} membro${roster.length === 1 ? '' : 's'}`}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <section aria-label="Fluxo das conversas" className="flex flex-col gap-2">
        <h2 className="text-heading-3 text-n-slate-12">Fluxo das conversas</h2>
        {catalog.inboxes.length === 0 && (
          <p className="text-sm text-n-slate-11">
            Nenhuma caixa de entrada: conecte um WhatsApp para criar uma.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {catalog.inboxes.map((inbox) => {
            const agent = byId(inbox.ai_agent_id);
            return (
              <li
                key={inbox.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-n-alpha-2 px-3 py-2 text-sm text-n-slate-12"
              >
                <InboxIcon size={14} className="text-n-slate-10" />
                {inbox.name}
                <ArrowRight size={14} className="text-n-slate-10" />
                {agent ? (
                  <>
                    <span className="font-medium">{agent.name}</span>
                    {chain(agent).map((boss) => (
                      <span key={boss.id} className="inline-flex items-center gap-2 text-n-slate-11">
                        <ArrowRight size={14} className="text-n-slate-10" />
                        escala para {boss.name}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-n-slate-11">equipe humana (sem agente de IA)</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {notes.length > 0 && (
        <section aria-label="Pontos de atenção" className="rounded-lg bg-n-amber-3 px-3 py-2">
          {notes.map((note) => (
            <p key={note} className="flex items-start gap-2 text-sm text-n-amber-12">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              {note}
            </p>
          ))}
        </section>
      )}
      <section aria-label="Hierarquia" className="flex flex-col gap-2">
        <h2 className="text-heading-3 text-n-slate-12">Hierarquia</h2>
        {loading && !data ? (
          <p className="text-sm text-n-slate-11">Carregando…</p>
        ) : roster.length === 0 ? (
          <p className="py-10 text-center text-n-slate-12">Nenhum membro.</p>
        ) : (
          <Branch
            nodes={below(null)}
            below={below}
            roster={roster}
            inboxes={catalog.inboxes}
            onChanged={reload}
          />
        )}
      </section>
    </SettingsPage>
  );
}

interface BranchProps {
  nodes: RosterAgent[];
  below: (id: number | null) => RosterAgent[];
  roster: RosterAgent[];
  inboxes: Catalog['inboxes'];
  onChanged: () => void;
  depth?: number;
}

function Branch({ nodes, below, roster, inboxes, onChanged, depth = 0 }: BranchProps) {
  return (
    <ul
      role={depth ? 'group' : 'tree'}
      aria-label={depth ? undefined : 'Organograma'}
      className="flex flex-col gap-2"
    >
      {nodes.map((agent) => {
        const children = depth < 20 ? below(agent.id) : [];
        return (
          <li
            key={agent.id}
            role="treeitem"
            aria-label={agent.name}
            aria-expanded={children.length > 0 || undefined}
          >
            <Node agent={agent} roster={roster} inboxes={inboxes} onChanged={onChanged} />
            {children.length > 0 && (
              <div className="ms-6 mt-2 border-s-2 border-n-weak ps-4">
                <Branch
                  nodes={children}
                  below={below}
                  roster={roster}
                  inboxes={inboxes}
                  onChanged={onChanged}
                  depth={depth + 1}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Node({
  agent,
  roster,
  inboxes,
  onChanged,
}: {
  agent: RosterAgent;
  roster: RosterAgent[];
  inboxes: Catalog['inboxes'];
  onChanged: () => void;
}) {
  const { error, busy, run } = useAction();
  const serves = inboxes.filter((i) => i.ai_agent_id === agent.id);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl bg-n-solid-2 px-3 py-2 outline outline-1 -outline-offset-1 outline-n-weak',
        !agent.active && 'opacity-60',
      )}
    >
      <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={36} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-n-slate-12">{agent.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-n-slate-11">
          {agent.kind === 'ai' ? <Bot size={12} /> : <UserRound size={12} />}
          {agent.role ? roleLabel(agent.role) : 'Sem função'}
          {serves.map((i) => (
            <span key={i.id} className="inline-flex items-center gap-1 rounded bg-n-alpha-2 px-1">
              <InboxIcon size={11} /> {i.name}
            </span>
          ))}
        </span>
        {error && <span className="block text-xs text-n-ruby-11">{error}</span>}
      </div>
      <label className="flex items-center gap-2 text-xs text-n-slate-11">
        Responde a
        <select
          className="field !h-8 !w-44"
          aria-label={`${agent.name} responde a`}
          disabled={busy}
          value={agent.supervisor_id ? String(agent.supervisor_id) : ''}
          onChange={(e) =>
            void run(async () => {
              const supervisor_id = e.target.value ? Number(e.target.value) : null;
              await http(`/agent_directory/${agent.id}`, 'PUT', agentBody(agent, { supervisor_id }));
              onChanged();
            })
          }
        >
          <option value="">Ninguém (topo)</option>
          {roster
            .filter((a) => a.id !== agent.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
