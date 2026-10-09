import { useState } from 'react';
import { Plus } from 'lucide-react';
import { http } from '../../api';
import type { CustomRole } from '../../adminTypes';
import { permissionLabel } from '../../permissions';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
import { CustomRoleModal } from './CustomRoleModal';
import { useCustomRoles } from './useCustomRoles';

interface Props {
  /** Reloads the catalog (agents of a deleted role go back to the default access). */
  onChange: () => Promise<void>;
}

/** Chatwoot Custom Roles: roles with their permissions, the add/edit modal and delete confirmation. */
export function CustomRolesPage({ onChange }: Props) {
  const { roles, error, reload } = useCustomRoles();
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null),
    [removing, setRemoving] = useState<CustomRole | null>(null);
  return (
    <SettingsPage>
      <SettingsHeader
        title="Perfis personalizados"
        description="Perfis limitam o que um agente pode fazer: quais conversas atende, se gerencia contatos e se vê relatórios. Agentes sem perfil mantêm o acesso padrão."
        count={`${roles.length} perfi${roles.length === 1 ? 'l' : 's'}`}
        action={<Button icon={Plus} label="Adicionar perfil" onClick={() => setEditing('new')} />}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table headers={['Perfil', 'Permissões', '']} rows={roles.length} empty="Nenhum perfil personalizado.">
        {roles.map((role) => (
          <tr key={role.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{role.name}</span>
              {role.description && <span className="text-sm">{role.description}</span>}
            </Cell>
            <Cell>{role.permissions.map(permissionLabel).join(', ') || 'Nenhuma permissão'}</Cell>
            <Cell className="w-24">
              <RowActions
                labelFor={role.name}
                onEdit={() => setEditing(role)}
                onDelete={() => setRemoving(role)}
              />
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <CustomRoleModal
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir o perfil “${removing.name}”?`}
          description="Os agentes com este perfil voltam ao acesso padrão."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/custom_roles/${removing.id}`, 'DELETE');
            reload();
            await onChange();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}
