import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog, Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { Catalog, Label } from '../types';
import C3Provider from '../c3/C3Provider';
import { useAction } from './useAction';

interface Props {
  catalog: Catalog;
  onChange: () => Promise<void>;
}

/**
 * Primeira tela do lote de migração (Configurações → Etiquetas) escrita sobre o C3Theme: painel, tabela de dados,
 * diálogo de ação e campos do MUI no lugar das classes utilitárias. Os contratos da tela continuam iguais
 * (título, busca, contagem, "Adicionar etiqueta", "Editar/Excluir <nome>") para os testes e o uso não mudarem.
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
    <C3Provider>
      <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default', p: { xs: 2, md: 3 } }}>
        <Stack spacing={2} sx={{ maxWidth: 1100, mx: 'auto' }}>
          <Panel>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="h4">Etiquetas</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Etiquetas ajudam a categorizar e priorizar conversas. Você pode adicioná-las pelo painel
                    da conversa.
                  </Typography>
                </Box>
                <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
                  Adicionar etiqueta
                </Button>
              </Stack>

              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <OutlinedInput
                  size="small"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Pesquisar etiquetas…"
                  startAdornment={
                    <InputAdornment position="start">
                      <Search size={14} />
                    </InputAdornment>
                  }
                  slotProps={{ input: { 'aria-label': 'Pesquisar etiquetas…' } }}
                  sx={{ width: 260 }}
                />
                <Typography variant="body2" color="text.secondary">
                  {count}
                </Typography>
              </Stack>

              {error && <Alert severity="error">{error}</Alert>}

              <DataTable
                rows={visible}
                columns={columns}
                getRowId={(label) => String(label.id)}
                paginate={visible.length > 10}
                empty="Nenhuma etiqueta ainda."
                ariaLabel="Etiquetas"
              />
            </Stack>
          </Panel>
        </Stack>
      </Box>
      {editing && (
        <LabelDialog
          label={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChange}
        />
      )}
    </C3Provider>
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
