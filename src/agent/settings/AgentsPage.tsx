import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { CustomRole } from '../adminTypes';
import type { Catalog, Role, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { SettingsHeader, SettingsPage } from '../ui/Settings';
import { AgentModal } from './AgentModal';
import { useCustomRoles } from './roles/useCustomRoles';

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

/** Chatwoot Agents: divided list (avatar, name, email | role | status) and the add agent modal. */
export function AgentsPage({ user, catalog, onChange }: Props) {
  const [q, setQ] = useState(''),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<User | null>(null);
  const { roles } = useCustomRoles();
  const visible = catalog.agents.filter((a) =>
    `${a.name} ${a.email}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <SettingsPage>
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
    </SettingsPage>
  );
}
