import { useEffect, useState } from 'react';
import { http } from '../api';
import type { Inbox, User } from '../types';
import type { SettingsProps } from './SettingsPage';
import { useAction } from './useAction';
import { InboxAutomation } from './InboxAutomation';

const FLAGS: { key: keyof Inbox; label: string; hint: string }[] = [
  {
    key: 'enable_auto_assignment',
    label: 'Atribuição automática',
    hint: 'Distribui novas conversas em rodízio entre agentes online.',
  },
  {
    key: 'lock_to_single_conversation',
    label: 'Uma conversa por contato',
    hint: 'Mensagem nova reabre a conversa resolvida em vez de criar outra.',
  },
  { key: 'ignore_groups', label: 'Ignorar grupos', hint: 'Grupos do WhatsApp não viram conversas.' },
  {
    key: 'agent_bot_enabled',
    label: 'Atendimento por IA (MCP)',
    hint: 'Conversas novas ficam pendentes para a IA até ela transferir para humanos.',
  },
];

export function InboxesSettings({ catalog, onChange }: SettingsProps) {
  const [selected, setSelected] = useState<number | null>(catalog.inboxes[0]?.id ?? null);
  const inbox = catalog.inboxes.find((i) => i.id === selected);
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Caixas de entrada</h2>
        <p className="muted">Cada sessão do WhatsApp conectada no app desktop é uma caixa de entrada.</p>
        <ul className="plain-list selectable">
          {catalog.inboxes.map((i) => (
            <li key={i.id}>
              <button className={i.id === selected ? 'active' : ''} onClick={() => setSelected(i.id)}>
                <strong>{i.name}</strong>
                <small>
                  {i.phone ? `+${i.phone}` : 'sem número'} · {i.session_status}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {inbox && (
        <div className="stack">
          <InboxEditor key={inbox.id} inbox={inbox} agents={catalog.agents} onChange={onChange} />
          <InboxAutomation key={`auto-${inbox.id}`} inbox={inbox} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function InboxEditor({
  inbox,
  agents,
  onChange,
}: {
  inbox: Inbox;
  agents: User[];
  onChange: () => Promise<void>;
}) {
  const [name, setName] = useState(inbox.name),
    [members, setMembers] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  useEffect(() => {
    void http<User[]>(`/inboxes/${inbox.id}/members`)
      .then((list) => setMembers(list.map((u) => u.id)))
      .catch(() => setMembers([]));
  }, [inbox.id]);
  const patch = (fields: Record<string, unknown>) =>
    run(async () => {
      await http(`/inboxes/${inbox.id}`, 'PATCH', fields);
      await onChange();
    });
  const toggleMember = (id: number) =>
    run(async () => {
      const add = !members.includes(id);
      const list = await http<User[]>(`/inboxes/${inbox.id}/members`, add ? 'POST' : 'DELETE', {
        user_ids: [id],
      });
      setMembers(list.map((u) => u.id));
      await onChange();
    });
  return (
    <section className="panel">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ name });
        }}
      >
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <button className="btn ghost small" disabled={busy || name === inbox.name}>
          Renomear
        </button>
      </form>
      {FLAGS.map((flag) => (
        <label key={flag.key} className="toggle">
          <input
            type="checkbox"
            checked={Boolean(inbox[flag.key])}
            onChange={(e) => void patch({ [flag.key]: e.target.checked })}
          />
          <span>
            <strong>{flag.label}</strong>
            <small>{flag.hint}</small>
          </span>
        </label>
      ))}
      <fieldset>
        <legend>Agentes com acesso</legend>
        {agents
          .filter((a) => a.active)
          .map((a) => (
            <label key={a.id} className="check">
              <input
                type="checkbox"
                checked={members.includes(a.id)}
                onChange={() => void toggleMember(a.id)}
              />
              {a.name}
              {a.role === 'administrator' && <small className="muted"> (admin vê todas)</small>}
            </label>
          ))}
      </fieldset>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
