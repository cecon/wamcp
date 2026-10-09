import { useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../api';
import type { Catalog, Role, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { ModalFooter, SettingsHeader, SettingsPage } from '../ui/Settings';
import { useAction } from './useAction';

const ROLE: Record<Role, string> = { administrator: 'Administrador', agent: 'Agente' };
const Divider = () => <span className="h-3 w-px bg-n-strong" />;

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
                  {ROLE[a.role]}
                  <Divider />
                  {a.active ? 'Ativo' : 'Desativado'}
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
      {adding && <AgentModal catalog={catalog} onClose={() => setAdding(false)} onSaved={onChange} />}
      {editing && (
        <AgentModal agent={editing} catalog={catalog} onClose={() => setEditing(null)} onSaved={onChange} />
      )}
    </SettingsPage>
  );
}

interface ModalProps {
  agent?: User;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function AgentModal({ agent, catalog, onClose, onSaved }: ModalProps) {
  const [form, setForm] = useState({
    name: agent?.name || '',
    email: '',
    password: '',
    role: agent?.role || ('agent' as Role),
  });
  const [inboxIds, setInboxIds] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  return (
    <Modal
      title={agent ? `Editar ${agent.name}` : 'Adicionar agente'}
      description={agent ? undefined : 'Crie o acesso e escolha as caixas de entrada que o agente atende.'}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (agent) await http(`/agents/${agent.id}`, 'PATCH', { name: form.name, role: form.role });
            else await http('/agents', 'POST', { ...form, inbox_ids: inboxIds });
            await onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome do agente</span>
          <input
            className="field"
            value={form.name}
            maxLength={80}
            required
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Função</span>
          <select
            className="field"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            <option value="agent">Agente</option>
            <option value="administrator">Administrador</option>
          </select>
        </label>
        {!agent && (
          <>
            <label>
              <span className="field-label">E-mail</span>
              <input
                className="field"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Senha inicial (mín. 10 caracteres)</span>
              <input
                className="field"
                type="password"
                minLength={10}
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <fieldset>
              <legend className="field-label">Caixas de entrada</legend>
              <div className="flex flex-col gap-2">
                {catalog.inboxes.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-n-brand"
                      checked={inboxIds.includes(i.id)}
                      onChange={() =>
                        setInboxIds((ids) =>
                          ids.includes(i.id) ? ids.filter((x) => x !== i.id) : [...ids, i.id],
                        )
                      }
                    />
                    {i.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {agent && (
          <Button
            color="ruby"
            variant="faded"
            className="self-start"
            label={agent.active ? 'Desativar acesso' : 'Reativar acesso'}
            onClick={() =>
              void run(async () => {
                await http(`/agents/${agent.id}`, 'PATCH', { active: !agent.active });
                await onSaved();
                onClose();
              })
            }
          />
        )}
        <ModalFooter
          busy={busy}
          submit={agent ? 'Salvar' : 'Adicionar agente'}
          onCancel={onClose}
          error={error}
        />
      </form>
    </Modal>
  );
}
