import { useState } from 'react';
import { http } from '../../api';
import type { CustomRole, RosterAgent, RosterKind, Skill } from '../../adminTypes';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { CredentialsPanel } from './CredentialsPanel';
import { SkillPicker } from './SkillPicker';
import { AccessSection } from './AccessSection';
import { noAccess } from './access';
import { executes, holdsCredentials, phone, roleLabel, RUNTIMES } from './labels';

interface Props {
  agent: RosterAgent | null;
  /** Kind of a new agent (an existing agent keeps its kind). */
  kind: RosterKind;
  skills: Skill[];
  /** Profiles: AI agents pick one with an AI role, people any. */
  profiles: CustomRole[];
  /** Opens the login settings of a person with helpdesk access. */
  onManageAccess: (userId: number) => void;
  onClose: () => void;
  onSaved: () => void;
  /** A skill was created from this form (the page reloads its library). */
  onSkillsChanged: () => void;
}

/** Human or AI agent form: role, contact (humans) or runtime and instructions (AI), skills and credentials. */
export function AgentRosterModal(props: Props) {
  const { agent, kind, skills, profiles, onManageAccess, onClose, onSaved, onSkillsChanged } = props;
  const human = (agent?.kind ?? kind) === 'human';
  // People and AI share the roles of the profiles; AI agents need one with a role.
  const choices = human ? profiles : profiles.filter((p) => p.agent_role);
  const initial = human
    ? profiles.find((p) => p.builtin)
    : (choices.find((p) => p.agent_role === 'operator') ?? choices[0]);
  const [form, setForm] = useState({
    name: agent?.name || '',
    profile_id: String(agent?.profile_id ?? initial?.id ?? ''),
    description: agent?.description || '',
    whatsapp: phone(agent?.whatsapp_jid ?? null),
    runtime: agent?.runtime || RUNTIMES[0].value,
    model: agent?.model || '',
    instructions: agent?.instructions || '',
    active: agent?.active ?? true,
  });
  const [skillIds, setSkillIds] = useState<number[]>(agent?.skill_ids || []);
  const [library, setLibrary] = useState(skills);
  const [access, setAccess] = useState(noAccess);
  const { error, busy, run } = useAction();
  const field = (
    key: 'name' | 'profile_id' | 'description' | 'whatsapp' | 'runtime' | 'model' | 'instructions',
  ) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const chosen = profiles.find((p) => String(p.id) === form.profile_id);
  const withSkills = executes(chosen?.agent_role ?? null);
  const toggle = (id: number) =>
    setSkillIds((list) => (list.includes(id) ? list.filter((s) => s !== id) : [...list, id]));

  const body = (userId: number | null) => {
    const common = {
      name: form.name.trim(),
      kind: human ? 'human' : 'ai',
      profile_id: Number(form.profile_id) || null,
      description: form.description.trim() || null,
      active: form.active,
    };
    if (human) return { ...common, whatsapp: form.whatsapp.trim() || null, user_id: userId };
    return {
      ...common,
      runtime: form.runtime,
      model: form.model.trim() || null,
      instructions: form.instructions.trim() || null,
    };
  };

  return (
    <Modal
      title={agent ? `Editar ${agent.name}` : human ? 'Adicionar pessoa' : 'Adicionar agente de IA'}
      description={
        human
          ? 'Uma pessoa da equipe: com WhatsApp, os agentes de IA podem consultá-la; com acesso ao helpdesk, ela entra e atende conversas.'
          : 'Agentes de IA executados por um runtime agêntico. Coordenadores só delegam; os demais executam com as suas skills.'
      }
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            // A new login first: every login is already a person, which this save then completes.
            let userId = agent?.user_id ?? null;
            if (human && !userId && access.enabled) {
              const login = { name: form.name.trim(), email: access.email, password: access.password };
              const created = await http<{ id: number }>('/agents', 'POST', {
                ...login,
                role: access.role,
                inbox_ids: [],
              });
              userId = created.id;
            }
            const saved = await http<RosterAgent>(
              agent ? `/agent_directory/${agent.id}` : '/agent_directory',
              agent ? 'PUT' : 'POST',
              body(userId),
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
          <span className="field-label">Perfil</span>
          <select className="field" required {...field('profile_id')}>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.agent_role ? `${p.name} — ${roleLabel(p.agent_role)}` : p.name}
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
            <AccessSection agent={agent} access={access} onChange={setAccess} onManage={onManageAccess} />
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
      {agent && holdsCredentials(agent) && <CredentialsPanel agentId={agent.id} onChange={onSaved} />}
    </Modal>
  );
}
