import { useState } from 'react';

// material-ui
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';

// third-party
import { FilterX, ListFilter } from 'lucide-react';

import type { Catalog, CustomFilter } from '../types';
import type { Route } from '../route';
import { FilterModal } from '../filters/FilterModal';
import { SaveViewButton, ViewMenu } from '../filters/SavedViewControls';

type ConversationsRoute = Extract<Route, { page: 'conversations' }>;

interface Props {
  route: ConversationsRoute;
  catalog: Catalog;
  view?: CustomFilter;
  onNavigate: (route: Route) => void;
  onViewsChange: () => void;
}

/** Ações de filtro/views da lista de conversas no C3Theme (lote 20). */
export function ConversationFilters({ route, catalog, view, onNavigate, onViewsChange }: Props) {
  const [open, setOpen] = useState(false);
  const filters = route.filters;
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <IconButton size="small" aria-label="Filtrar conversas" onClick={() => setOpen(true)}>
        <ListFilter size={16} />
      </IconButton>
      {filters && !view && (
        <SaveViewButton
          filterType="conversation"
          payload={filters}
          onSaved={(saved) => {
            onViewsChange();
            onNavigate({ page: 'conversations', viewId: saved.id, filters });
          }}
        />
      )}
      {view && (
        <ViewMenu
          view={view}
          onRenamed={onViewsChange}
          onDeleted={() => {
            onViewsChange();
            onNavigate({ page: 'conversations' });
          }}
        />
      )}
      {filters && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<FilterX size={14} />}
          onClick={() => onNavigate({ page: 'conversations' })}
        >
          Limpar filtros
        </Button>
      )}
      {open && (
        <FilterModal
          type="conversation"
          catalog={catalog}
          initial={filters}
          onClose={() => setOpen(false)}
          onApply={(payload) => {
            setOpen(false);
            onNavigate({ page: 'conversations', filters: payload });
          }}
        />
      )}
    </Stack>
  );
}
