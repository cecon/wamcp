import { useState } from 'react';
import { Bot, UserRound } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent, RosterKind, SalarySheet, Skill } from '../../adminTypes';
import type { Catalog, User } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { SettingsHeader } from '../../ui/Settings';
import { AgentModal } from '../AgentModal';
import { AgentRosterModal } from './AgentRosterModal';
import { useCustomRoles } from '../roles/useCustomRoles';
import { MemberCard } from '../members/MemberCard';
import { MemberDetail } from '../members/MemberDetail';
import { brl } from '../members/format';

interface Props {
  user: User;
  catalog: Catalog;
  /** Reloads the catalog (logins are part of it). */
  onChange: () => Promise<void>;
}

type Filter = 'all' | RosterKind;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'human', label: 'Pessoas' },
  { value: 'ai', label: 'Agentes de IA' },
];

/**
 * "Funcionários": every member in one grid — people (with or without a helpdesk login) and AI agents,
 * each with a profile — with the month's salaries and a detail pane for the selected one.
 */
export function RosterSection({ user, catalog, onChange }: Props) {
  const { data, error, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const { data: skills, reload: reloadSkills } = useFetch<Skill[]>('/skills');
  const { data: fetched, reload: reloadSheet } = useFetch<SalarySheet>('/agent_directory/salaries');
  // Salaries are extra information: anything but a sheet (an older server) just hides them.
  const sheet = Array.isArray(fetched?.salaries) ? fetched : null;
  const { roles: profiles } = useCustomRoles();
  const [editing, setEditing] = useState<{ agent: RosterAgent | null; kind: RosterKind } | null>(null),
    [access, setAccess] = useState<User | null>(null),
    [removing, setRemoving] = useState<RosterAgent | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [filter, setFilter] = useState<Filter>('all'),
    [search, setSearch] = useState('');
  const agents = data || [];
  const changed = async () => {
    reload();
    reloadSheet();
    await onChange();
  };
  const salaryOf = (id: number) => sheet?.salaries.find((s) => s.agent_id === id);
  const term = search.trim().toLowerCase();
  const shown = agents.filter(
    (a) =>
      (filter === 'all' || a.kind === filter) &&
      (!term || `${a.name} ${a.profile_name ?? ''}`.toLowerCase().includes(term)),
  );
  const detail = agents.find((a) => a.id === selected);
  const total = (kind?: RosterKind) =>
    (sheet?.salaries || []).filter((s) => !kind || s.kind === kind).reduce((sum, s) => sum + s.salary_brl, 0);

  return (
    <>
      <SettingsHeader
        title="Funcionários"
        description="Pessoas e agentes de IA, com as mesmas funções: coordenadores delegam; operadores, suporte dev e QA executam com as suas skills. O perfil de cada um define as permissões e a função. Pessoas ocupam um assento fixo; o salário de um agente de IA começa o mês em zero e cresce com o custo dos tokens das suas tarefas."
        search={{ value: search, onChange: setSearch, placeholder: 'Buscar funcionário' }}
        count={`${agents.length} agente${agents.length === 1 ? '' : 's'}`}
        action={
          <div className="flex gap-2">
            <Button
              icon={UserRound}
              label="Adicionar pessoa"
              onClick={() => setEditing({ agent: null, kind: 'human' })}
            />
            <Button
              icon={Bot}
              label="Adicionar agente de IA"
              onClick={() => setEditing({ agent: null, kind: 'ai' })}
            />
          </div>
        }
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrar" className="flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              color="slate"
              variant={filter === f.value ? 'solid' : 'faded'}
              label={f.label}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            />
          ))}
        </div>
        {sheet && (
          <p className="text-sm text-n-slate-11" aria-label="Folha do mês">
            Folha de {sheet.month.split('-').reverse().join('/')}:{' '}
            <strong className="text-n-slate-12">{brl(total())}</strong> · pessoas {brl(total('human'))} · IA{' '}
            {brl(total('ai'))} até agora
          </p>
        )}
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {shown.length === 0 && <p className="py-20 text-center text-n-slate-12">Nenhum agente.</p>}
          {shown.map((agent) => (
            <MemberCard
              key={agent.id}
              agent={agent}
              skills={skills || []}
              salary={salaryOf(agent.id)}
              you={agent.user_id === user.id}
              selected={agent.id === selected}
              onOpen={() => setSelected(agent.id)}
              onEdit={() => setEditing({ agent, kind: agent.kind })}
              onDelete={agent.user_id === user.id ? undefined : () => setRemoving(agent)}
            />
          ))}
        </div>
        {detail && (
          <div className="xl:sticky xl:top-0 xl:w-[24rem]">
            <MemberDetail
              agent={detail}
              roster={agents}
              skills={skills || []}
              salary={salaryOf(detail.id)}
              rates={sheet?.rates}
              inboxes={catalog.inboxes}
              onEdit={() => setEditing({ agent: detail, kind: detail.kind })}
              onClose={() => setSelected(null)}
              onChanged={() => void changed()}
            />
          </div>
        )}
      </div>
      {editing && (
        <AgentRosterModal
          agent={editing.agent}
          kind={editing.kind}
          skills={skills || []}
          profiles={profiles}
          onManageAccess={(id) => {
            setEditing(null);
            setAccess(catalog.agents.find((u) => u.id === id) ?? null);
          }}
          onClose={() => setEditing(null)}
          onSaved={() => void changed()}
          onSkillsChanged={reloadSkills}
        />
      )}
      {access && (
        <AgentModal
          agent={access}
          catalog={catalog}
          roles={profiles}
          onClose={() => setAccess(null)}
          onSaved={changed}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir o agente “${removing.name}”?`}
          description={
            removing.user_id
              ? 'O acesso ao helpdesk desta pessoa também é removido, junto com as suas skills.'
              : 'As skills ligadas a ele e as suas credenciais são removidas.'
          }
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/agent_directory/${removing.id}`, 'DELETE');
            if (selected === removing.id) setSelected(null);
            await changed();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
