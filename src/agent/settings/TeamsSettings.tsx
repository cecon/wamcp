import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { http } from '../api';
import type { Team, User } from '../types';
import type { SettingsProps } from './SettingsPage';
import { useAction } from './useAction';

export function TeamsSettings({ catalog, onChange }: SettingsProps) {
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<number | null>(null);
  const { error, busy, run } = useAction();
  const team = catalog.teams.find((t) => t.id === selected);
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Times</h2>
        <ul className="plain-list selectable">
          {catalog.teams.map((t) => (
            <li key={t.id}>
              <button className={t.id === selected ? 'active' : ''} onClick={() => setSelected(t.id)}>
                <strong>{t.name}</strong>
                <small>{t.member_count ?? 0} membro(s)</small>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const created = await http<Team>('/teams', 'POST', { name });
              setName('');
              setSelected(created.id);
              await onChange();
            });
          }}
        >
          <label>
            Novo time
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <button className="btn primary small" disabled={busy}>
            Criar
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </section>
      {team && (
        <TeamEditor
          key={team.id}
          team={team}
          agents={catalog.agents}
          onChange={onChange}
          onDeleted={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface EditorProps {
  team: Team;
  agents: User[];
  onChange: () => Promise<void>;
  onDeleted: () => void;
}

function TeamEditor({ team, agents, onChange, onDeleted }: EditorProps) {
  const [members, setMembers] = useState<number[]>([]);
  const { error, run } = useAction();
  useEffect(() => {
    void http<User[]>(`/teams/${team.id}/members`)
      .then((list) => setMembers(list.map((u) => u.id)))
      .catch(() => setMembers([]));
  }, [team.id]);
  const toggle = (id: number) =>
    run(async () => {
      const add = !members.includes(id);
      const list = await http<User[]>(`/teams/${team.id}/members`, add ? 'POST' : 'DELETE', {
        user_ids: [id],
      });
      setMembers(list.map((u) => u.id));
      await onChange();
    });
  return (
    <section className="panel">
      <h2>{team.name}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={Boolean(team.allow_auto_assign)}
          onChange={(e) =>
            void run(async () => {
              await http(`/teams/${team.id}`, 'PATCH', { allow_auto_assign: e.target.checked });
              await onChange();
            })
          }
        />
        <span>
          <strong>Atribuição automática no time</strong>
          <small>Ao direcionar uma conversa ao time, um membro online a recebe.</small>
        </span>
      </label>
      <fieldset>
        <legend>Membros</legend>
        {agents
          .filter((a) => a.active)
          .map((a) => (
            <label key={a.id} className="check">
              <input type="checkbox" checked={members.includes(a.id)} onChange={() => void toggle(a.id)} />
              {a.name}
            </label>
          ))}
      </fieldset>
      <button
        className="btn danger small"
        onClick={() =>
          void run(async () => {
            if (!window.confirm(`Excluir o time ${team.name}?`)) return;
            await http(`/teams/${team.id}`, 'DELETE');
            onDeleted();
            await onChange();
          })
        }
      >
        <Trash2 size={14} /> Excluir time
      </button>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
