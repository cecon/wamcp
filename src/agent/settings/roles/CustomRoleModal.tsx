import { useState } from 'react';
import { http } from '../../api';
import type { CustomRole, Permission, Skill } from '../../adminTypes';
import { PERMISSIONS } from '../../permissions';
import { useFetch } from '../../useFetch';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { executes, ROLES } from '../directory/labels';
import { SkillPicker } from '../directory/SkillPicker';

interface Props {
  role: CustomRole | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Profile form: name, description, role, the skills its agents inherit and the permission checkboxes. */
export function CustomRoleModal({ role, onClose, onSaved }: Props) {
  const [name, setName] = useState(role?.name || ''),
    [description, setDescription] = useState(role?.description || ''),
    [permissions, setPermissions] = useState<Permission[]>(role?.permissions || []),
    [agentRole, setAgentRole] = useState<string>(role?.agent_role || ''),
    [skillIds, setSkillIds] = useState<number[]>(role?.skill_ids || []),
    [created, setCreated] = useState<Skill[]>([]);
  const { data: skills } = useFetch<Skill[]>('/skills');
  const library = [...(skills || []), ...created.filter((c) => !skills?.some((s) => s.id === c.id))];
  const withSkills = executes(agentRole || null);
  const { error, busy, run } = useAction();
  const toggle = (key: Permission) =>
    setPermissions((list) => (list.includes(key) ? list.filter((p) => p !== key) : [...list, key]));

  return (
    <Modal
      title={role ? 'Editar perfil' : 'Adicionar perfil'}
      description="Todo agente, pessoa ou IA, tem um perfil. Ele define as permissões e a função: coordenador, operador, suporte dev ou QA. Agentes de IA precisam de um perfil com função."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = {
              name: name.trim(),
              description: description.trim() || null,
              permissions,
              agent_role: agentRole || null,
              skill_ids: withSkills ? skillIds : [],
            };
            await http(role ? `/custom_roles/${role.id}` : '/custom_roles', role ? 'PUT' : 'POST', body);
            onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome do perfil</span>
          <input
            className="field"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <textarea
            className="field"
            rows={2}
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Função</span>
          <select className="field" value={agentRole} onChange={(e) => setAgentRole(e.target.value)}>
            <option value="">Nenhuma</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </option>
            ))}
          </select>
        </label>
        {withSkills && (
          <div className="flex flex-col gap-1">
            <SkillPicker
              library={library}
              selected={skillIds}
              onToggle={(id) =>
                setSkillIds((list) => (list.includes(id) ? list.filter((s) => s !== id) : [...list, id]))
              }
              onCreated={(skill) => {
                setCreated((list) => [...list, skill]);
                setSkillIds((list) => [...list, skill.id]);
              }}
            />
            <p className="text-xs text-n-slate-11">
              Todo agente deste perfil, pessoa ou IA, herda estas skills, somadas às dele.
            </p>
          </div>
        )}
        <fieldset>
          <legend className="field-label">Permissões</legend>
          <div className="flex flex-col gap-2.5">
            {PERMISSIONS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-n-slate-12">
                <input
                  type="checkbox"
                  className="size-4 accent-n-brand"
                  checked={permissions.includes(key)}
                  onChange={() => toggle(key)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <ModalFooter
          busy={busy}
          submit={role ? 'Atualizar perfil' : 'Criar perfil'}
          onCancel={onClose}
          error={error}
        />
      </form>
    </Modal>
  );
}
