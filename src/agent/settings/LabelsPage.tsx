import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Pencil, Plus, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog, Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { Catalog, Label } from '../types';
import { useAction } from './useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

interface Props {
  catalog: Catalog;
  onChange: () => Promise<void>;
}

/**
 * Tela piloto do lote 1 (Configurações → Etiquetas) sobre o C3Theme: painel, tabela de dados, diálogo de ação e
 * campos do MUI. Os contratos continuam iguais (título, busca, contagem, "Adicionar etiqueta",
 * "Editar/Excluir <nome>") para os testes e o uso não mudarem.
 */
export function LabelsPage({ catalog, onChange }: Props) {
  const [q, setQ] = useState(''),
    [editing, setEditing] = useState<Label | 'new' | null>(null);
  const { error, run } = useAction();
  const visible = catalog.labels.filter((label) => label.title.includes(q.toLowerCase()));
  const count = `${catalog.labels.length} etiqueta${catalog.labels.length === 1 ? '' : 's'}`;

  const columns: ColumnDef<Label>[] = [
    {
      id: 'title',
      header: 'Nome',
      accessorKey: 'title',
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {info.row.original.title}
        </Typography>
      ),
    },
    {
      id: 'description',
      header: 'Descrição',
      accessorFn: (label) => label.description || '—',
      cell: (info) => (
        <Typography variant="body2" color="text.secondary">
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'color',
      header: 'Cor',
      accessorFn: (label) => label.color,
      cell: (info) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 16,
              height: 16,
              borderRadius: 0.5,
              border: 1,
              borderColor: 'divider',
              bgcolor: info.row.original.color,
            }}
          />
          <Typography variant="caption">{info.row.original.color}</Typography>
        </Stack>
      ),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (info) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <IconButton
            size="small"
            aria-label={`Editar ${info.row.original.title}`}
            onClick={() => setEditing(info.row.original)}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={`Excluir ${info.row.original.title}`}
            onClick={() =>
              void run(async () => {
                await http(`/labels/${info.row.original.id}`, 'DELETE');
                await onChange();
              })
            }
          >
            <Trash2 size={14} />
          </IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Etiquetas"
        description="Etiquetas ajudam a categorizar e priorizar conversas. Você pode adicioná-las pelo painel da conversa."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar etiquetas…' }}
        count={count}
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Adicionar etiqueta
          </Button>
        }
      />
      <Panel flush>
        {error && (
          <Box sx={{ p: 2 }}>
            <SettingsC3Error>{error}</SettingsC3Error>
          </Box>
        )}
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(label) => String(label.id)}
          paginate={visible.length > 10}
          empty="Nenhuma etiqueta ainda."
          ariaLabel="Etiquetas"
        />
      </Panel>
      {editing && (
        <LabelDialog
          label={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChange}
        />
      )}
    </SettingsC3Page>
  );
}

/** Criar/editar etiqueta no `ActionDialog` do pacote (mesmos campos e regras de antes). */
function LabelDialog({
  label,
  onClose,
  onSaved,
}: {
  label: Label | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: label?.title || '',
    description: label?.description || '',
    color: label?.color || '#2781F6',
  });
  const { error, busy, run } = useAction();
  const dirty =
    form.title !== (label?.title || '') ||
    form.description !== (label?.description || '') ||
    form.color !== (label?.color || '#2781F6');

  return (
    <ActionDialog
      open
      title={label ? 'Editar etiqueta' : 'Adicionar etiqueta'}
      description="O nome vira minúsculas e sem espaços."
      confirmLabel={label ? 'Salvar' : 'Criar'}
      backLabel="Cancelar"
      dirty={dirty}
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          const body = { ...form, description: form.description.trim() || null };
          await http(label ? `/labels/${label.id}` : '/labels', label ? 'PATCH' : 'POST', body);
          await onSaved();
          onClose();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Nome da etiqueta"
          size="small"
          required
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 40 } }}
        />
        <TextField
          label="Descrição"
          size="small"
          multiline
          minRows={2}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">Cor</Typography>
          <Box
            component="input"
            type="color"
            aria-label="Cor"
            value={form.color}
            onChange={(event) => setForm({ ...form, color: event.target.value })}
            sx={{ width: 40, height: 32, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }}
          />
          <Typography variant="caption">{form.color.toUpperCase()}</Typography>
        </Stack>
      </Stack>
    </ActionDialog>
  );
}
