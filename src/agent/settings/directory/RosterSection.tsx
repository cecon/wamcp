import { useState } from 'react';
import { Bot, UserRound } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent, RosterKind, Skill } from '../../adminTypes';
import type { Catalog } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, Table } from '../../ui/Settings';
import { AgentRosterModal } from './AgentRosterModal';
import { phone, roleLabel, runtimeLabel } from './labels';

const TEXT = {
  human: {
    title: 'Consultados pelo WhatsApp',
    description:
      'Pessoas que os agentes de IA chamam no próprio WhatsApp para tirar dúvidas ou aprovar algo. Não precisam ter login no helpdesk.',
    add: 'Adicionar pessoa',
    contact: 'WhatsApp / login',
  },
  ai: {
    title: 'Agentes de IA',
    description:
      'Coordenadores só delegam; operadores, suporte dev e QA executam com as suas skills e credenciais, num runtime agêntico.',
    add: 'Adicionar agente de IA',
    contact: 'Runtime',
  },
};

interface Props {
  kind: RosterKind;
  catalog: Catalog;
}

/** One kind of the agent roster: people consulted on WhatsApp, or AI agents with skills and credentials. */
export function RosterSection({ kind, catalog }: Props) {
  const { data, error, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const { data: skills, reload: reloadSkills } = useFetch<Skill[]>('/skills');
  const [editing, setEditing] = useState<RosterAgent | 'new' | null>(null),
    [removing, setRemoving] = useState<RosterAgent | null>(null);
  const agents = (data || []).filter((a) => a.kind === kind);
  const text = TEXT[kind];
  const skillNames = (agent: RosterAgent) =>
    agent.skill_ids
      .map((id) => skills?.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .join(', ');

  return (
    <section className="flex flex-col gap-4" aria-label={text.title}>
      <SettingsHeader
        title={text.title}
        description={text.description}
        count={`${agents.length} ${kind === 'ai' ? 'agente' : 'pessoa'}${agents.length === 1 ? '' : 's'}`}
        action={
          <Button icon={kind === 'ai' ? Bot : UserRound} label={text.add} onClick={() => setEditing('new')} />
        }
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table
        headers={
          kind === 'ai'
            ? ['Agente', 'Função', text.contact, 'Skills', '']
            : ['Pessoa', 'Função', text.contact, '']
        }
        rows={agents.length}
        empty={kind === 'ai' ? 'Nenhum agente de IA.' : 'Ninguém cadastrado para consulta.'}
      >
        {agents.map((agent) => (
          <tr key={agent.id} className={agent.active ? '' : 'opacity-60'}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{agent.name}</span>
              {agent.description && <span className="text-sm">{agent.description}</span>}
            </Cell>
            <Cell>{roleLabel(agent.role)}</Cell>
            <Cell>
              {agent.kind === 'human'
                ? [phone(agent.whatsapp_jid), agent.user_name].filter(Boolean).join(' · ')
                : [runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ')}
            </Cell>
            {kind === 'ai' && (
              <Cell>
                {skillNames(agent) || '—'}
                {agent.credential_count > 0 && (
                  <span className="block text-xs">
                    {agent.credential_count} credencia{agent.credential_count === 1 ? 'l' : 'is'}
                  </span>
                )}
              </Cell>
            )}
            <Cell className="w-24">
              <RowActions
                labelFor={agent.name}
                onEdit={() => setEditing(agent)}
                onDelete={() => setRemoving(agent)}
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <AgentRosterModal
          agent={editing === 'new' ? null : editing}
          kind={kind}
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
    </section>
  );
}
