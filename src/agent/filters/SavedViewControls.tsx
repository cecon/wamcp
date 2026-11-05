import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

// third-party
import { EllipsisVertical, Pencil, Save, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../api';
import type { CustomFilter, FilterCondition, FilterType } from '../types';
import { useAction } from '../settings/useAction';
import C3Provider from '../c3/C3Provider';

function NameModal({
  title,
  initial = '',
  submit,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  submit: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const { error, busy, run } = useAction();
  return (
    <C3Provider>
      <ActionDialog
        open
        title={title}
        confirmLabel={submit}
        backLabel="Cancelar"
        loading={busy}
        error={error}
        dirty={name !== initial}
        onClose={onClose}
        onConfirm={() => {
          const trimmed = name.trim();
          if (!trimmed) return;
          void run(async () => {
            await onSubmit(trimmed);
            onClose();
          });
        }}
      >
        <TextField
          label="Nome da visualização"
          size="small"
          fullWidth
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 80, autoFocus: true, required: true } }}
          sx={{ mt: 1 }}
        />
      </ActionDialog>
    </C3Provider>
  );
}

/** "Salvar visualização": stores the current filter as a Chatwoot custom filter (folder/segment). */
export function SaveViewButton({
  filterType,
  payload,
  onSaved,
}: {
  filterType: FilterType;
  payload: FilterCondition[];
  onSaved: (view: CustomFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<Save size={14} />} onClick={() => setOpen(true)}>
        Salvar visualização
      </Button>
      {open && (
        <NameModal
          title="Salvar visualização"
          submit="Salvar"
          onClose={() => setOpen(false)}
          onSubmit={async (name) =>
            onSaved(
              await http<CustomFilter>('/custom_filters', 'POST', {
                name,
                filter_type: filterType,
                query: { payload },
              }),
            )
          }
        />
      )}
    </>
  );
}

/** Rename / delete menu of the active saved view (owner only on the server). */
export function ViewMenu({
  view,
  onRenamed,
  onDeleted,
}: {
  view: CustomFilter;
  onRenamed: (view: CustomFilter) => void;
  onDeleted: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const path = `/custom_filters/${view.id}`;
  const close = () => setAnchor(null);
  return (
    <C3Provider>
      <IconButton
        size="small"
        aria-label="Opções da visualização"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <EllipsisVertical size={14} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ paper: { sx: { width: 220 } } }}
      >
        <MenuItem
          onClick={() => {
            close();
            setDialog('rename');
          }}
        >
          <ListItemIcon>
            <Pencil size={14} />
          </ListItemIcon>
          <ListItemText>Renomear visualização</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            setDialog('delete');
          }}
        >
          <ListItemIcon>
            <Trash2 size={14} />
          </ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>Excluir visualização</ListItemText>
        </MenuItem>
      </Menu>
      {dialog === 'rename' && (
        <NameModal
          title="Renomear visualização"
          initial={view.name}
          submit="Salvar"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => onRenamed(await http<CustomFilter>(path, 'PATCH', { name }))}
        />
      )}
      {dialog === 'delete' && (
        <ActionDialog
          open
          title="Excluir visualização"
          description={`A visualização “${view.name}” será removida. As conversas e contatos não são afetados.`}
          confirmLabel="Excluir"
          backLabel="Cancelar"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void http(path, 'DELETE')
              .then(onDeleted)
              .catch(() => {})
          }
        />
      )}
    </C3Provider>
  );
}
