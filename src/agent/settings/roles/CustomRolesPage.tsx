import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Plus } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../../api';
import type { CustomRole } from '../../adminTypes';
import { permissionLabel } from '../../permissions';
import { ConfirmModal } from '../../ui/Confirm';
import { RowActions } from '../../ui/Settings';
import { CustomRoleModal } from './CustomRoleModal';
import { useCustomRoles } from './useCustomRoles';
import { roleLabel } from '../directory/labels';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';

interface Props {
  /** Reloads the catalog (agents of a deleted role go back to the default access). */
  onChange: () => Promise<void>;
}

/** Perfis no C3Theme (lote 34): perfis com função/permissões, modal de adicionar/editar e exclusão. */
export function CustomRolesPage({ onChange }: Props) {
  const { roles, error, reload } = useCustomRoles();
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null),
    [removing, setRemoving] = useState<CustomRole | null>(null);

  const columns: ColumnDef<CustomRole>[] = [
    {
      id: 'name',
      header: 'Perfil',
      accessorFn: (role) => role.name,
      cell: (info) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {info.row.original.name}
          </Typography>
          {info.row.original.description && (
            <Typography variant="caption" component="span" color="text.secondary" sx={{ display: 'block' }}>
              {info.row.original.description}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'agent_role',
      header: 'Função',
      accessorFn: (role) => (role.agent_role ? roleLabel(role.agent_role) : '—'),
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'permissions',
      header: 'Permissões',
      cell: (info) => {
        const permissions = info.row.original.permissions.map(permissionLabel).join(', ');
        return <Typography variant="body2">{permissions || 'Nenhuma permissão'}</Typography>;
      },
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <RowActions
            labelFor={info.row.original.name}
            onEdit={() => setEditing(info.row.original)}
            onDelete={info.row.original.builtin ? undefined : () => setRemoving(info.row.original)}
          />
        </Stack>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Perfis"
        description="Todo agente, humano ou de IA, tem um perfil: ele define quais conversas atende, se gerencia contatos e se vê relatórios e a função (coordenador, operador…), igual para pessoas e IA. O perfil Padrão mantém o acesso padrão e não pode ser excluído."
        count={`${roles.length} perfi${roles.length === 1 ? 'l' : 's'}`}
        action={
          <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => setEditing('new')}>
            Adicionar perfil
          </Button>
        }
      />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={roles}
          columns={columns}
          getRowId={(role) => String(role.id)}
          empty="Nenhum perfil personalizado."
          ariaLabel="Perfis"
        />
      </Panel>
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
          description="Os agentes com este perfil passam para o perfil Padrão."
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/custom_roles/${removing.id}`, 'DELETE');
            reload();
            await onChange();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsC3Page>
  );
}
