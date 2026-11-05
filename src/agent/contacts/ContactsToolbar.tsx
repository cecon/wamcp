import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';

// third-party
import { Download, FilterX, ListFilter, Plus, Upload } from 'lucide-react';

import { download } from '../api';
import type { Catalog, Contact, FilterCondition } from '../types';
import { FilterModal } from '../filters/FilterModal';
import { SaveViewButton, ViewMenu } from '../filters/SavedViewControls';
import { useSavedViews } from '../filters/useSavedViews';
import { ImportModal } from './ImportModal';
import { NewContactModal } from './NewContactModal';

export interface ContactScope {
  filters: FilterCondition[] | null;
  viewId: number | null;
}

interface Props {
  scope: ContactScope;
  catalog: Catalog;
  isAdmin: boolean;
  onScope: (scope: ContactScope) => void;
  onCreated: (contact: Contact) => void;
  onReload: () => void;
  onError: (message: string) => void;
}

type Dialog = 'filter' | 'new' | 'import' | null;

const OUTLINED = { variant: 'outlined', size: 'small' } as const;

/** Contacts header actions: filter, saved segments, import/export (admin) and "Novo contato". */
export function ContactsToolbar({ scope, catalog, isAdmin, onScope, onCreated, onReload, onError }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const { views, reload } = useSavedViews('contact');
  const view = views.find((v) => v.id === scope.viewId);
  const close = () => setDialog(null);
  const clear = () => onScope({ filters: null, viewId: null });
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}
    >
      {views.length > 0 && (
        <Select
          native
          size="small"
          value={scope.viewId == null ? '' : String(scope.viewId)}
          inputProps={{ 'aria-label': 'Visualizações de contatos' }}
          onChange={(event) => {
            const picked = views.find((v) => v.id === Number(event.target.value));
            if (picked) onScope({ filters: picked.query?.payload || [], viewId: picked.id });
            else clear();
          }}
          sx={{ width: 176, fontSize: 14 }}
        >
          <option value="">Todos os contatos</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      )}
      {view && (
        <ViewMenu
          view={view}
          onRenamed={() => void reload()}
          onDeleted={() => {
            void reload();
            clear();
          }}
        />
      )}
      {scope.filters && !view && (
        <SaveViewButton
          filterType="contact"
          payload={scope.filters}
          onSaved={(saved) => {
            void reload();
            onScope({ filters: scope.filters, viewId: saved.id });
          }}
        />
      )}
      {scope.filters && (
        <Button {...OUTLINED} startIcon={<FilterX size={14} />} onClick={clear}>
          Limpar filtros
        </Button>
      )}
      <Button {...OUTLINED} startIcon={<ListFilter size={14} />} onClick={() => setDialog('filter')}>
        Filtrar
      </Button>
      {isAdmin && (
        <>
          <Button {...OUTLINED} startIcon={<Upload size={14} />} onClick={() => setDialog('import')}>
            Importar
          </Button>
          <Button
            {...OUTLINED}
            startIcon={<Download size={14} />}
            onClick={() =>
              void download('/contacts/export', 'contatos.csv').catch((e: Error) => onError(e.message))
            }
          >
            Exportar
          </Button>
        </>
      )}
      <Button
        variant="contained"
        size="small"
        startIcon={<Plus size={14} />}
        onClick={() => setDialog('new')}
      >
        Novo contato
      </Button>
      {dialog === 'filter' && (
        <FilterModal
          type="contact"
          catalog={catalog}
          initial={scope.filters || undefined}
          onClose={close}
          onApply={(filters) => {
            close();
            onScope({ filters, viewId: null });
          }}
        />
      )}
      {dialog === 'new' && <NewContactModal onClose={close} onCreated={onCreated} />}
      {dialog === 'import' && <ImportModal onClose={close} onImported={onReload} />}
    </Stack>
  );
}
