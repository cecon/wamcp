import { useState } from 'react';
import { FilterX, ListFilter } from 'lucide-react';
import type { Catalog, CustomFilter } from '../types';
import type { Route } from '../route';
import { FilterModal } from '../filters/FilterModal';
import { SaveViewButton, ViewMenu } from '../filters/SavedViewControls';
import { Button } from '../ui/Button';

type ConversationsRoute = Extract<Route, { page: 'conversations' }>;

interface Props {
  route: ConversationsRoute;
  catalog: Catalog;
  view?: CustomFilter;
  onNavigate: (route: Route) => void;
  onViewsChange: () => void;
}

/** Chat list header actions for advanced filters and saved views (Chatwoot folders). */
export function ConversationFilters({ route, catalog, view, onNavigate, onViewsChange }: Props) {
  const [open, setOpen] = useState(false);
  const filters = route.filters;
  return (
    <>
      <Button
        color="slate"
        variant="faded"
        size="xs"
        icon={ListFilter}
        aria-label="Filtrar conversas"
        onClick={() => setOpen(true)}
      />
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
          color="slate"
          variant="faded"
          size="xs"
          icon={FilterX}
          label="Limpar filtros"
          onClick={() => onNavigate({ page: 'conversations' })}
        />
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
    </>
  );
}
