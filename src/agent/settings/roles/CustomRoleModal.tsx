import { useState } from 'react';
import { http } from '../../api';
import type { CustomRole, Permission } from '../../adminTypes';
import { PERMISSIONS } from '../../permissions';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';

interface Props {
  role: CustomRole | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Chatwoot custom role form: name, description and the permission checkboxes. */
export function CustomRoleModal({ role, onClose, onSaved }: Props) {
  const [name, setName] = useState(role?.name || ''),
    [description, setDescription] = useState(role?.description || ''),
    [permissions, setPermissions] = useState<Permission[]>(role?.permissions || []);
  const { error, busy, run } = useAction();
  const toggle = (key: Permission) =>
    setPermissions((list) => (list.includes(key) ? list.filter((p) => p !== key) : [...list, key]));

  return (
    <Modal
      title={role ? 'Editar perfil' : 'Adicionar perfil'}
      description="Agentes com este perfil têm exatamente as permissões marcadas. Sem permissão de conversas, veem só as atribuídas a eles."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = { name: name.trim(), description: description.trim() || null, permissions };
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
