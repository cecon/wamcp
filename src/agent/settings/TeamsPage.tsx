import { useEffect, useState } from 'react';
import { Plus, Settings, UsersRound } from 'lucide-react';
import { http } from '../api';
import type { Catalog, Team, User } from '../types';
import type { Route } from '../route';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { ModalFooter, SettingsHeader, SettingsPage, Toggle } from '../ui/Settings';
import { useAction } from './useAction';

interface Props {
  catalog: Catalog;
  teamId?: number;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

/** Chatwoot Teams: icon-tile list, "Create new team" modal, and a team page with members. */
export function TeamsPage({ catalog, teamId, onNavigate, onChange }: Props) {
  const [creating, setCreating] = useState(false);
  const team = teamId ? catalog.teams.find((t) => t.id === teamId) : undefined;
  if (team) return <TeamDetail team={team} catalog={catalog} onNavigate={onNavigate} onChange={onChange} />;
  return (
    <SettingsPage>
      <SettingsHeader
        title="Times"
        description="Times agrupam agentes por responsabilidade. Uma conversa direcionada ao time pode ser atribuída a um membro online."
        count={`${catalog.teams.length} time${catalog.teams.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Criar novo time" onClick={() => setCreating(true)} />}
      />
      <ul className="divide-y divide-n-weak border-t border-n-weak">
        {catalog.teams.length === 0 && <li className="py-20 text-center text-base">Nenhum time ainda.</li>}
        {catalog.teams.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-n-slate-10 outline outline-1 -outline-offset-1 outline-n-weak">
                <UsersRound size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-heading-3 truncate text-n-slate-12">{t.name}</p>
                <p className="truncate text-sm text-n-slate-11">
                  {t.description || 'Sem descrição'} · {t.member_count ?? 0} membro(s)
                </p>
              </div>
            </div>
            <Button
              color="slate"
              variant="faded"
              icon={Settings}
              aria-label={`Configurar ${t.name}`}
              onClick={() => onNavigate({ page: 'settings', section: 'teams', id: t.id })}
            />
          </li>
        ))}
      </ul>
      {creating && <TeamModal onClose={() => setCreating(false)} onSaved={onChange} />}
    </SettingsPage>
  );
}

function TeamModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', description: '' });
  const { error, busy, run } = useAction();
  return (
    <Modal title="Criar novo time" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/teams', 'POST', { name: form.name, description: form.description || null });
            await onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome do time</span>
          <input
            className="field"
            required
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <textarea
            className="field"
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <ModalFooter busy={busy} submit="Criar time" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}

interface DetailProps {
  team: Team;
  catalog: Catalog;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

function TeamDetail({ team, catalog, onNavigate, onChange }: DetailProps) {
  const [members, setMembers] = useState<number[]>([]);
  const { error, run } = useAction();
  useEffect(() => {
    void http<User[]>(`/teams/${team.id}/members`)
      .then((list) => setMembers(list.map((u) => u.id)))
      .catch(() => setMembers([]));
  }, [team.id]);
  const back = () => onNavigate({ page: 'settings', section: 'teams' });
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
    <SettingsPage>
      <SettingsHeader
        title={team.name}
        description={team.description || undefined}
        back={{ label: 'Times', onClick: back }}
      />
      <section className="rounded-xl px-4 outline outline-1 -outline-offset-1 outline-n-weak">
        <Toggle
          label="Atribuição automática no time"
          hint="Ao direcionar uma conversa ao time, um membro online a recebe em rodízio."
          checked={Boolean(team.allow_auto_assign)}
          onChange={(allow) =>
            void run(async () => {
              await http(`/teams/${team.id}`, 'PATCH', { allow_auto_assign: allow });
              await onChange();
            })
          }
        />
      </section>
      <h2 className="text-heading-3 mt-2">Membros</h2>
      <ul className="divide-y divide-n-weak border-t border-n-weak">
        {catalog.agents
          .filter((a) => a.active)
          .map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 py-3">
              <span className="flex items-center gap-3">
                <Avatar name={a.name} size={32} status={a.availability} />
                <span className="text-sm text-n-slate-12">{a.name}</span>
              </span>
              <Toggle
                compact
                label={`Membro ${a.name}`}
                checked={members.includes(a.id)}
                onChange={() => void toggle(a.id)}
              />
            </li>
          ))}
      </ul>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Button
        color="ruby"
        variant="faded"
        className="self-start"
        label="Excluir time"
        onClick={() =>
          void run(async () => {
            if (!window.confirm(`Excluir o time ${team.name}?`)) return;
            await http(`/teams/${team.id}`, 'DELETE');
            await onChange();
            back();
          })
        }
      />
    </SettingsPage>
  );
}
