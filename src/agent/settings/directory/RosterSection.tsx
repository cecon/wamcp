import { useState } from 'react';
import { Bot, UserRound } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent, RosterKind, Skill } from '../../adminTypes';
import type { Catalog, User } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, Table } from '../../ui/Settings';
import { AgentModal } from '../AgentModal';
import { AgentRosterModal } from './AgentRosterModal';
import { useCustomRoles } from '../roles/useCustomRoles';
import { phone, roleLabel, runtimeLabel } from './labels';

interface Props {
  user: User;
  catalog: Catalog;
  /** Reloads the catalog (logins are part of it). */
  onChange: () => Promise<void>;
}

/** Every agent in one list: people (with or without a helpdesk login) and AI agents, each with a profile. */
export function RosterSection({ user, catalog, onChange }: Props) {
  const { data, error, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const { data: skills, reload: reloadSkills } = useFetch<Skill[]>('/skills');
  const { roles: profiles } = useCustomRoles();
  const [editing, setEditing] = useState<{ agent: RosterAgent | null; kind: RosterKind } | null>(null),
    [access, setAccess] = useState<User | null>(null),
    [removing, setRemoving] = useState<RosterAgent | null>(null);
  const agents = data || [];
  const changed = async () => {
    reload();
    await onChange();
  };
  const skillNames = (agent: RosterAgent) =>
    [...new Set([...(agent.profile_skill_ids || []), ...agent.skill_ids])]
      .map((id) => skills?.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  const contact = (agent: RosterAgent) =>
    agent.kind === 'human'
      ? [agent.user_email, phone(agent.whatsapp_jid)].filter(Boolean).join(' · ')
      : [runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ');

  return (
    <>
      <SettingsHeader
        title="Agentes"
        description="Pessoas e agentes de IA, com as mesmas funções: coordenadores delegam; operadores, suporte dev e QA executam com as suas skills. O perfil de cada agente define as permissões e a função. Pessoas podem ter acesso ao helpdesk e um WhatsApp para serem consultadas pelos agentes de IA."
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
      <Table
        headers={['Agente', 'Perfil', 'Contato', 'Skills', '']}
        rows={agents.length}
        empty="Nenhum agente."
      >
        {agents.map((agent) => (
          <tr key={agent.id} className={agent.active ? '' : 'opacity-60'}>
            <Cell>
              <span className="block font-medium text-n-slate-12">
                {agent.name}
                {agent.user_id === user.id && <span className="text-n-slate-10"> (você)</span>}
              </span>
              <span className="text-xs">{agent.kind === 'ai' ? 'IA' : 'Pessoa'}</span>
            </Cell>
            <Cell>
              {agent.profile_name ?? '—'}
              {agent.role && <span className="block text-xs">{roleLabel(agent.role)}</span>}
            </Cell>
            <Cell className="break-all">{contact(agent) || '—'}</Cell>
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
                onDelete={agent.user_id === user.id ? undefined : () => setRemoving(agent)}
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
            await changed();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
