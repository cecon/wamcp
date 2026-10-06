import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { http } from '../api';
import type { Role, User } from '../types';
import type { SettingsProps } from './SettingsPage';
import { useAction } from './useAction';

const ROLE: Record<Role, string> = { administrator: 'Administrador', agent: 'Agente' };
const empty = { name: '', email: '', password: '', role: 'agent' as Role, inbox_ids: [] as number[] };

export function AgentsSettings({ user, catalog, onChange }: SettingsProps) {
  const [form, setForm] = useState(empty);
  const { error, busy, run } = useAction();
  const toggleInbox = (id: number) =>
    setForm((f) => ({
      ...f,
      inbox_ids: f.inbox_ids.includes(id) ? f.inbox_ids.filter((i) => i !== id) : [...f.inbox_ids, id],
    }));
  const update = (agent: User, fields: Record<string, unknown>) =>
    run(async () => {
      await http(`/agents/${agent.id}`, 'PATCH', fields);
      await onChange();
    });
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Agentes</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Papel</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {catalog.agents.map((a) => (
              <tr key={a.id} className={a.active ? '' : 'inactive'}>
                <td>
                  <strong>{a.name}</strong>
                  <small>{a.email}</small>
                </td>
                <td>
                  <select
                    value={a.role}
                    disabled={a.id === user.id}
                    onChange={(e) => void update(a, { role: e.target.value })}
                    aria-label={`Papel de ${a.name}`}
                  >
                    {Object.entries(ROLE).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <i className={`presence ${a.availability}`} /> {a.active ? a.availability : 'desativado'}
                </td>
                <td className="row-actions">
                  {a.id !== user.id && (
                    <button className="btn ghost small" onClick={() => void update(a, { active: !a.active })}>
                      {a.active ? 'Desativar' : 'Reativar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="form-error">{error}</p>}
      </section>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/agents', 'POST', form);
            setForm(empty);
            await onChange();
          });
        }}
      >
        <h2>
          <UserPlus size={18} /> Novo agente
        </h2>
        <label>
          Nome
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={80}
          />
        </label>
        <label>
          E-mail
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </label>
        <label>
          Senha inicial (mín. 10 caracteres)
          <input
            type="password"
            value={form.password}
            minLength={10}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Papel
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="agent">Agente</option>
            <option value="administrator">Administrador</option>
          </select>
        </label>
        <fieldset>
          <legend>Caixas de entrada</legend>
          {catalog.inboxes.map((i) => (
            <label key={i.id} className="check">
              <input
                type="checkbox"
                checked={form.inbox_ids.includes(i.id)}
                onChange={() => toggleInbox(i.id)}
              />
              {i.name}
            </label>
          ))}
        </fieldset>
        <button className="btn primary" disabled={busy}>
          Criar agente
        </button>
      </form>
    </div>
  );
}
