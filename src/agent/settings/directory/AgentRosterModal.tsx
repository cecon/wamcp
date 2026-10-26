import { useState } from 'react';
import { http } from '../../api';
import type { RosterAgent, RosterKind, Skill } from '../../adminTypes';
import type { User } from '../../types';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { CredentialsPanel } from './CredentialsPanel';
import { SkillPicker } from './SkillPicker';
import { executes, phone, ROLES, RUNTIMES } from './labels';

interface Props {
  agent: RosterAgent | null;
  /** Kind of a new agent (an existing agent keeps its kind). */
  kind: RosterKind;
  skills: Skill[];
  logins: User[];
  onClose: () => void;
  onSaved: () => void;
  /** A skill was created from this form (the page reloads its library). */
  onSkillsChanged: () => void;
}

/** Human or AI agent form: role, contact (humans) or runtime and instructions (AI), skills and credentials. */
export function AgentRosterModal({ agent, kind, skills, logins, onClose, onSaved, onSkillsChanged }: Props) {
  const human = (agent?.kind ?? kind) === 'human';
  const [form, setForm] = useState({
    name: agent?.name || '',
    role: agent?.role || 'operator',
    description: agent?.description || '',
    whatsapp: phone(agent?.whatsapp_jid ?? null),
    user_id: agent?.user_id ? String(agent.user_id) : '',
    runtime: agent?.runtime || RUNTIMES[0].value,
    model: agent?.model || '',
    instructions: agent?.instructions || '',
    active: agent?.active ?? true,
  });
  const [skillIds, setSkillIds] = useState<number[]>(agent?.skill_ids || []);
  const [library, setLibrary] = useState(skills);
  const { error, busy, run } = useAction();
  const field = (
    key: 'name' | 'role' | 'description' | 'whatsapp' | 'user_id' | 'runtime' | 'model' | 'instructions',
  ) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const withSkills = executes({ kind: human ? 'human' : 'ai', role: form.role });
  const toggle = (id: number) =>
    setSkillIds((list) => (list.includes(id) ? list.filter((s) => s !== id) : [...list, id]));

  const body = () => {
    const common = {
      name: form.name.trim(),
      kind: human ? 'human' : 'ai',
      role: form.role,
      description: form.description.trim() || null,
      active: form.active,
    };
    if (human)
      return { ...common, whatsapp: form.whatsapp.trim() || null, user_id: Number(form.user_id) || null };
    return {
      ...common,
      runtime: form.runtime,
      model: form.model.trim() || null,
      instructions: form.instructions.trim() || null,
    };
  };

  return (
    <Modal
      title={`${agent ? 'Editar' : 'Adicionar'} agente ${human ? 'humano' : 'de IA'}`}
      description={
        human
          ? 'Pessoas da equipe que os agentes de IA podem consultar pelo WhatsApp quando precisarem de ajuda.'
          : 'Agentes de IA executados por um runtime agêntico. Coordenadores só delegam; os demais executam com as suas skills.'
      }
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const saved = await http<RosterAgent>(
              agent ? `/agent_directory/${agent.id}` : '/agent_directory',
              agent ? 'PUT' : 'POST',
              body(),
            );
            const same = [...skillIds].sort().join() === [...saved.skill_ids].sort().join();
            if (!same)
              await http(`/agent_directory/${saved.id}/skills`, 'PUT', {
                skill_ids: withSkills ? skillIds : [],
              });
            onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome</span>
          <input className="field" required maxLength={80} {...field('name')} />
        </label>
        <label>
          <span className="field-label">Função</span>
          <select className="field" {...field('role')}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <textarea className="field" rows={2} maxLength={500} {...field('description')} />
        </label>
        {human ? (
          <>
            <label>
              <span className="field-label">WhatsApp</span>
              <input
                className="field"
                inputMode="tel"
                placeholder="+55 11 98888-7777"
                {...field('whatsapp')}
              />
            </label>
            <label>
              <span className="field-label">Login no helpdesk (opcional)</span>
              <select className="field" {...field('user_id')}>
                <option value="">Sem login</option>
                {logins.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              <span className="field-label">Runtime</span>
              <select className="field" {...field('runtime')}>
                {RUNTIMES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Modelo (opcional)</span>
              <input
                className="field"
                maxLength={80}
                placeholder={
                  form.runtime === 'openclaude'
                    ? 'Modelo do OpenRouter (ex.: openai/gpt-5)'
                    : 'Padrão do runtime'
                }
                {...field('model')}
              />
            </label>
            <label>
              <span className="field-label">Instruções do agente</span>
              <textarea className="field" rows={4} maxLength={8000} {...field('instructions')} />
            </label>
          </>
        )}
        {withSkills && (
          <SkillPicker
            library={library}
            selected={skillIds}
            onToggle={toggle}
            onCreated={(skill) => {
              setLibrary((list) => [...list, skill]);
              setSkillIds((list) => [...list, skill.id]);
              onSkillsChanged();
            }}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-n-slate-12">
          <input
            type="checkbox"
            className="size-4 accent-n-brand"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Ativo
        </label>
        <ModalFooter
          busy={busy}
          submit={agent ? 'Atualizar agente' : 'Criar agente'}
          onCancel={onClose}
          error={error}
        />
      </form>
      {agent && executes(agent) && <CredentialsPanel agentId={agent.id} onChange={onSaved} />}
    </Modal>
  );
}
