import { useState } from 'react';
import { Bot, Plus, UserRound } from 'lucide-react';
import type { CustomRole } from '../adminTypes';
import type { Catalog, Role, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { SettingsHeader, SettingsPage } from '../ui/Settings';
import { AgentModal } from './AgentModal';
import { useCustomRoles } from './roles/useCustomRoles';
import { RosterSection } from './directory/RosterSection';

const ROLE: Record<Role, string> = { administrator: 'Administrador', agent: 'Agente' };
const Divider = () => <span className="h-3 w-px bg-n-strong" />;

/** Role shown in the list: the custom role name when the agent has one. */
function roleName(agent: User, roles: CustomRole[]) {
  if (agent.role === 'agent' && agent.custom_role_id != null)
    return roles.find((r) => r.id === agent.custom_role_id)?.name || 'Perfil personalizado';
  return ROLE[agent.role];
}

interface Props {
  user: User;
  catalog: Catalog;
  onChange: () => Promise<void>;
}

const TABS = [
  { value: 'human', label: 'Humanos', icon: UserRound },
  { value: 'ai', label: 'IA', icon: Bot },
] as const;

/** Agents: the people of the team (logins, plus people consulted on WhatsApp) and the AI agents. */
export function AgentsPage({ user, catalog, onChange }: Props) {
  const [tab, setTab] = useState<'human' | 'ai'>('human');
  return (
    <SettingsPage>
      <div role="tablist" aria-label="Tipo de agente" className="flex gap-1 border-b border-n-weak">
        {TABS.map((t) => (
          <Button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            icon={t.icon}
            color={tab === t.value ? 'blue' : 'slate'}
            variant="ghost"
            label={t.label}
            onClick={() => setTab(t.value)}
          />
        ))}
      </div>
      {tab === 'human' ? (
        <>
          <LoginAgents user={user} catalog={catalog} onChange={onChange} />
          <RosterSection kind="human" catalog={catalog} />
        </>
      ) : (
        <RosterSection kind="ai" catalog={catalog} />
      )}
    </SettingsPage>
  );
}

/** Chatwoot Agents: divided list (avatar, name, email | role | status) and the add agent modal. */
function LoginAgents({ user, catalog, onChange }: Props) {
  const [q, setQ] = useState(''),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<User | null>(null);
  const { roles } = useCustomRoles();
  const visible = catalog.agents.filter((a) =>
    `${a.name} ${a.email}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <section className="flex flex-col gap-4" aria-label="Pessoas com login">
      <SettingsHeader
        title="Agentes"
        description="Agentes são as pessoas da equipe que respondem as conversas. Administradores também gerenciam as configurações."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar agentes…' }}
        count={`${catalog.agents.length} agente${catalog.agents.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar agente" onClick={() => setAdding(true)} />}
      />
      <ul className="divide-y divide-n-weak border-t border-n-weak">
        {visible.map((a) => (
          <li
            key={a.id}
            className={`flex items-center justify-between gap-4 py-4 ${a.active ? '' : 'opacity-60'}`}
          >
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={a.name} size={40} status={a.active ? a.availability : undefined} />
              <div className="min-w-0">
                <p className="text-heading-3 truncate text-n-slate-12">
                  {a.name}
                  {a.id === user.id && <span className="text-n-slate-10"> (você)</span>}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-sm text-n-slate-11">
                  <span className="truncate">{a.email}</span>
                  <Divider />
                  <span>{roleName(a, roles)}</span>
                  <Divider />
                  {a.active ? 'Ativo' : 'Desativado'}
                  {a.mfa_enabled ? (
                    <>
                      <Divider />
                      Verificação em duas etapas
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            {a.id !== user.id && (
              <Button
                color="slate"
                variant="faded"
                label="Editar"
                aria-label={`Editar ${a.name}`}
                onClick={() => setEditing(a)}
              />
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <AgentModal catalog={catalog} roles={roles} onClose={() => setAdding(false)} onSaved={onChange} />
      )}
      {editing && (
        <AgentModal
          agent={editing}
          catalog={catalog}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={onChange}
        />
      )}
    </section>
  );
}
