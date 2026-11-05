import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Pencil, Plus, Trash2 } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { Macro } from '../accountTypes';
import type { Catalog, User } from '../types';
import { ACTIONS } from '../labels';
import { useMacros, VISIBILITY_LABEL } from '../macros/useMacros';
import { ConfirmModal } from '../ui/Confirm';
import { SidePanel } from '../ui/Overlay';
import { MacroEditor, type MacroDraft } from './MacroEditor';
import { useAction } from './useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

/**
 * Configurações → Macros no C3Theme (lote 2): a lista e o cabeçalho são do pacote; o editor de macro e a
 * confirmação de exclusão continuam os do app (são os próximos candidatos do lote).
 */
export function MacrosPage({ user, catalog }: { user: User; catalog: Catalog }) {
  const { macros, error: loadError, reload } = useMacros();
  const [q, setQ] = useState(''),
    [editing, setEditing] = useState<Macro | 'new' | null>(null),
    [deleting, setDeleting] = useState<Macro | null>(null);
  const { error, busy, run } = useAction();
  const isAdmin = user.role === 'administrator';
  const visible = macros.filter((macro) => macro.name.toLowerCase().includes(q.toLowerCase()));
  const count = `${macros.length} macro${macros.length === 1 ? '' : 's'}`;
  const save = (draft: MacroDraft) =>
    void run(async () => {
      if (editing === 'new') await http('/macros', 'POST', draft);
      else if (editing) await http(`/macros/${editing.id}`, 'PATCH', draft);
      setEditing(null);
      await reload();
    });

  const columns: ColumnDef<Macro>[] = [
    {
      id: 'name',
      header: 'Nome',
      accessorKey: 'name',
      cell: (info) => (
        <Stack>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {info.row.original.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {info.row.original.actions
              .map((action) => ACTIONS[action.action_name] || action.action_name)
              .join(' → ')}
          </Typography>
        </Stack>
      ),
    },
    {
      id: 'created_by',
      header: 'Criada por',
      accessorFn: (macro) => macro.created_by_name || '—',
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'visibility',
      header: 'Visibilidade',
      accessorFn: (macro) => VISIBILITY_LABEL[macro.visibility],
      cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => {
        const macro = info.row.original;
        const editable = isAdmin || macro.visibility === 'personal';
        if (!editable) return null;
        return (
          <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
            <IconButton size="small" aria-label={`Editar ${macro.name}`} onClick={() => setEditing(macro)}>
              <Pencil size={14} />
            </IconButton>
            <IconButton
              size="small"
              color="error"
              aria-label={`Excluir ${macro.name}`}
              onClick={() => setDeleting(macro)}
            >
              <Trash2 size={14} />
            </IconButton>
          </Stack>
        );
      },
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Macros"
        description="Uma macro é um conjunto de ações salvas (atribuir, etiquetar, responder, resolver…) que o agente executa em uma conversa com um único clique."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar macros…' }}
        count={count}
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Adicionar macro
          </Button>
        }
      />
      {loadError && <SettingsC3Error>{loadError}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(macro) => String(macro.id)}
          paginate={visible.length > 10}
          empty="Nenhuma macro encontrada."
          ariaLabel="Macros"
        />
      </Panel>
      {editing && (
        <SidePanel
          title={editing === 'new' ? 'Adicionar macro' : 'Editar macro'}
          onClose={() => setEditing(null)}
        >
          <MacroEditor
            macro={editing === 'new' ? undefined : editing}
            catalog={catalog}
            isAdmin={isAdmin}
            busy={busy}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </SidePanel>
      )}
      {deleting && (
        <ConfirmModal
          title="Excluir macro"
          description={`Você tem certeza que deseja excluir “${deleting.name}”?`}
          confirm="Sim, excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await http(`/macros/${deleting.id}`, 'DELETE');
            await reload();
          }}
        />
      )}
    </SettingsC3Page>
  );
}
