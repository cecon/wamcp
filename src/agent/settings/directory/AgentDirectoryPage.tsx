import { useState } from 'react';
import { Bot, UserRound } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent, RosterKind, Skill } from '../../adminTypes';
import type { Catalog } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
import { AgentRosterModal } from './AgentRosterModal';
import { phone, roleLabel, runtimeLabel } from './labels';

type Filter = 'all' | RosterKind;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'human', label: 'Humanos' },
  { value: 'ai', label: 'IA' },
];

/** The agent roster: human agents (consulted on WhatsApp) and AI agents with roles, skills and credentials. */
export function AgentDirectoryPage({ catalog }: { catalog: Catalog }) {
  const { data, error, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const { data: skills, reload: reloadSkills } = useFetch<Skill[]>('/skills');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ agent: RosterAgent | null; kind: RosterKind } | null>(null),
    [removing, setRemoving] = useState<RosterAgent | null>(null);
  const agents = (data || []).filter((a) => filter === 'all' || a.kind === filter);
  const skillNames = (agent: RosterAgent) =>
    agent.skill_ids
      .map((id) => skills?.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .join(', ');

  return (
    <SettingsPage>
      <SettingsHeader
        title="Equipe de agentes"
        description="Agentes humanos e de IA. Coordenadores só delegam; operadores, suporte dev e QA executam com as suas skills e credenciais. Humanos são consultados pelos agentes de IA no próprio WhatsApp."
        count={`${data?.length ?? 0} agente${data?.length === 1 ? '' : 's'}`}
        action={
          <div className="flex gap-2">
            <Button
              icon={UserRound}
              label="Agente humano"
              onClick={() => setEditing({ agent: null, kind: 'human' })}
            />
            <Button icon={Bot} label="Agente de IA" onClick={() => setEditing({ agent: null, kind: 'ai' })} />
          </div>
        }
      />
      <div className="flex gap-1" role="tablist" aria-label="Filtrar agentes">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            size="sm"
            color={filter === f.value ? 'blue' : 'slate'}
            variant="faded"
            label={f.label}
            onClick={() => setFilter(f.value)}
          />
        ))}
      </div>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table
        headers={['Agente', 'Função', 'Contato / runtime', 'Skills', '']}
        rows={agents.length}
        empty="Nenhum agente."
      >
        {agents.map((agent) => (
          <tr key={agent.id} className={agent.active ? '' : 'opacity-60'}>
            <Cell>
              <span className="block font-medium text-n-slate-12">
                {agent.name}{' '}
                <span className="text-xs font-normal">{agent.kind === 'human' ? 'Humano' : 'IA'}</span>
              </span>
              {agent.description && <span className="text-sm">{agent.description}</span>}
            </Cell>
            <Cell>{roleLabel(agent.role)}</Cell>
            <Cell>
              {agent.kind === 'human'
                ? [phone(agent.whatsapp_jid), agent.user_name].filter(Boolean).join(' · ')
                : [runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ')}
            </Cell>
            <Cell>
              {skillNames(agent) || '—'}
              {agent.credential_count > 0 && (
                <span className="block text-xs">
                  {agent.credential_count} credencia{agent.credential_count === 1 ? 'l' : 'is'}
                </span>
              )}
            </Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={agent.name}
                onEdit={() => setEditing({ agent, kind: agent.kind })}
                onDelete={() => setRemoving(agent)}
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <AgentRosterModal
          agent={editing.agent}
          kind={editing.kind}
          skills={skills || []}
          logins={catalog.agents}
          onClose={() => setEditing(null)}
          onSaved={reload}
          onSkillsChanged={reloadSkills}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir o agente “${removing.name}”?`}
          description="As skills ligadas a ele e as suas credenciais são removidas."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/agent_directory/${removing.id}`, 'DELETE');
            reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}
