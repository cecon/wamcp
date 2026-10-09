import { useState } from 'react';
import { http } from '../api';
import type { CustomRole } from '../adminTypes';
import type { Catalog, Role, User } from '../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';
import { useAction } from './useAction';

interface Props {
  agent?: User;
  catalog: Catalog;
  roles: CustomRole[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/** Add / edit agent: name, role, custom role ("Perfil"); new agents also get e-mail, password and inboxes. */
export function AgentModal({ agent, catalog, roles, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: agent?.name || '',
    email: '',
    password: '',
    role: agent?.role || ('agent' as Role),
  });
  const current = agent?.custom_role_id ?? null;
  const [profile, setProfile] = useState<number | null>(current);
  const [inboxIds, setInboxIds] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  const roleChange = form.role === 'agent' && profile !== current ? { custom_role_id: profile } : {};

  async function save() {
    if (agent) {
      await http(`/agents/${agent.id}`, 'PATCH', { name: form.name, role: form.role, ...roleChange });
    } else {
      const created = await http<User>('/agents', 'POST', { ...form, inbox_ids: inboxIds });
      if (profile !== null && form.role === 'agent')
        await http(`/agents/${created.id}`, 'PATCH', { custom_role_id: profile });
    }
    await onSaved();
    onClose();
  }
  const once = (action: () => Promise<unknown>) =>
    void run(async () => {
      await action();
      await onSaved();
      onClose();
    });

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
          void run(save);
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
        {form.role === 'agent' && roles.length > 0 && (
          <label>
            <span className="field-label">Perfil</span>
            <select
              className="field"
              value={profile ?? ''}
              onChange={(e) => setProfile(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Agente padrão</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {agent?.mfa_enabled ? (
          <div className="flex flex-col gap-1">
            <Button
              color="slate"
              variant="faded"
              className="self-start"
              label="Redefinir verificação em duas etapas"
              onClick={() => once(() => http(`/agents/${agent.id}/mfa`, 'DELETE'))}
            />
            <span className="text-xs text-n-slate-11">
              Use quando o agente perder o aplicativo autenticador; ele entrará só com a senha.
            </span>
          </div>
        ) : null}
        {agent && (
          <Button
            color="ruby"
            variant="faded"
            className="self-start"
            label={agent.active ? 'Desativar acesso' : 'Reativar acesso'}
            onClick={() => once(() => http(`/agents/${agent.id}`, 'PATCH', { active: !agent.active }))}
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
