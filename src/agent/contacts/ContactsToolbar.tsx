import { useState } from 'react';
import { Download, FilterX, ListFilter, Plus, Upload } from 'lucide-react';
import { download } from '../api';
import type { Catalog, Contact, FilterCondition } from '../types';
import { FilterModal } from '../filters/FilterModal';
import { SaveViewButton, ViewMenu } from '../filters/SavedViewControls';
import { useSavedViews } from '../filters/useSavedViews';
import { Button } from '../ui/Button';
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

/** Contacts header actions: filter, saved segments, import/export (admin) and "Novo contato". */
export function ContactsToolbar({ scope, catalog, isAdmin, onScope, onCreated, onReload, onError }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const { views, reload } = useSavedViews('contact');
  const view = views.find((v) => v.id === scope.viewId);
  const close = () => setDialog(null);
  const clear = () => onScope({ filters: null, viewId: null });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.length > 0 && (
        <select
          className="field !h-8 !w-44 !py-1"
          aria-label="Visualizações de contatos"
          value={scope.viewId ?? ''}
          onChange={(e) => {
            const picked = views.find((v) => v.id === Number(e.target.value));
            if (picked) onScope({ filters: picked.query?.payload || [], viewId: picked.id });
            else clear();
          }}
        >
          <option value="">Todos os contatos</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
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
        <Button
          color="slate"
          variant="faded"
          size="sm"
          icon={FilterX}
          label="Limpar filtros"
          onClick={clear}
        />
      )}
      <Button
        color="slate"
        variant="faded"
        size="sm"
        icon={ListFilter}
        label="Filtrar"
        onClick={() => setDialog('filter')}
      />
      {isAdmin && (
        <>
          <Button
            color="slate"
            variant="faded"
            size="sm"
            icon={Upload}
            label="Importar"
            onClick={() => setDialog('import')}
          />
          <Button
            color="slate"
            variant="faded"
            size="sm"
            icon={Download}
            label="Exportar"
            onClick={() =>
              void download('/contacts/export', 'contatos.csv').catch((e: Error) => onError(e.message))
            }
          />
        </>
      )}
      <Button icon={Plus} label="Novo contato" onClick={() => setDialog('new')} />
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
    </div>
  );
}
