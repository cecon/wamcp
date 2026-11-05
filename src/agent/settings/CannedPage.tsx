import { useCallback, useEffect, useState } from 'react';

// material-ui
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
import type { Canned } from '../types';
import { useAction } from './useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

/** Configurações → Respostas prontas, no C3Theme (lote 2). Contratos: título, busca, contagem, atalho/conteúdo. */
export function CannedPage() {
  const [items, setItems] = useState<Canned[]>([]),
    [q, setQ] = useState(''),
    [editing, setEditing] = useState<Canned | 'new' | null>(null);
  const { error, run } = useAction();
  const load = useCallback(() => http<Canned[]>('/canned_responses').then(setItems), []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const visible = items.filter((canned) =>
    `${canned.short_code} ${canned.content}`.toLowerCase().includes(q.toLowerCase()),
  );
  const count = `${items.length} resposta${items.length === 1 ? '' : 's'}`;

  const columns: ColumnDef<Canned>[] = [
    {
      id: 'short_code',
      header: 'Atalho',
      accessorKey: 'short_code',
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          /{info.row.original.short_code}
        </Typography>
      ),
    },
    {
      id: 'content',
      header: 'Conteúdo',
      accessorKey: 'content',
      cell: (info) => (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            whiteSpace: 'pre-wrap',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
          }}
        >
          {info.row.original.content}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (info) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <IconButton
            size="small"
            aria-label={`Editar /${info.row.original.short_code}`}
            onClick={() => setEditing(info.row.original)}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={`Excluir /${info.row.original.short_code}`}
            onClick={() =>
              void run(async () => {
                await http(`/canned_responses/${info.row.original.id}`, 'DELETE');
                await load();
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
        title="Respostas prontas"
        description="Modelos de resposta para agilizar o atendimento. No editor, digite “/” seguido do atalho."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar respostas…' }}
        count={count}
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Adicionar resposta pronta
          </Button>
        }
      />
      <Panel flush>
        {error && (
          <Stack sx={{ p: 2 }}>
            <SettingsC3Error>{error}</SettingsC3Error>
          </Stack>
        )}
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(canned) => String(canned.id)}
          paginate={visible.length > 10}
          empty="Nenhuma resposta pronta ainda."
          ariaLabel="Respostas prontas"
        />
      </Panel>
      {editing && (
        <CannedDialog
          canned={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </SettingsC3Page>
  );
}

/** Criar/editar resposta pronta no `ActionDialog` (mesmos campos e limites de antes). */
function CannedDialog({
  canned,
  onClose,
  onSaved,
}: {
  canned: Canned | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({ short_code: canned?.short_code || '', content: canned?.content || '' });
  const { error, busy, run } = useAction();
  const dirty = form.short_code !== (canned?.short_code || '') || form.content !== (canned?.content || '');

  return (
    <ActionDialog
      open
      title={canned ? 'Editar resposta pronta' : 'Adicionar resposta pronta'}
      confirmLabel="Salvar"
      backLabel="Cancelar"
      dirty={dirty}
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          await http(
            canned ? `/canned_responses/${canned.id}` : '/canned_responses',
            canned ? 'PATCH' : 'POST',
            form,
          );
          await onSaved();
          onClose();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Atalho"
          size="small"
          required
          placeholder="saudacao"
          value={form.short_code}
          onChange={(event) => setForm({ ...form, short_code: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 40 } }}
        />
        <TextField
          label="Mensagem"
          size="small"
          required
          multiline
          rows={5}
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 4096 } }}
        />
      </Stack>
    </ActionDialog>
  );
}
