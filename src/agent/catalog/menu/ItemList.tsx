import { useState } from 'react';
import { Button } from '../../ui/Button';
import { catalogApi, moveId } from '../catalogApi';
import type { CatalogItem, CatalogStatus } from '../types';
import { ItemRow } from './ItemRow';

interface Props {
  items: CatalogItem[];
  /** Category whose order the up/down buttons change (none on search results). */
  categoryId: number | null;
  editable: boolean;
  empty: string;
  onOpen: (item: CatalogItem) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** Item cards of the selected category, with multi-select bulk pause/activate. */
export function ItemList({ items, categoryId, editable, empty, onOpen, onChanged, onError }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const chosen = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const act = (action: () => Promise<unknown>) =>
    void action()
      .then(onChanged)
      .catch((e: Error) => onError(e.message));
  const bulk = (status: CatalogStatus) =>
    act(async () => {
      await catalogApi.setItemsStatus(chosen, status);
      setSelected(new Set());
    });
  const toggle = (id: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-2">
      {editable && chosen.length > 0 && (
        <div
          role="toolbar"
          aria-label="Ações em massa"
          className="flex items-center gap-2 rounded-xl bg-n-solid-blue px-3 py-2 text-sm"
        >
          <span className="flex-1 text-n-slate-12">
            {chosen.length} {chosen.length === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          <Button size="xs" color="amber" label="Pausar" onClick={() => bulk('unavailable')} />
          <Button size="xs" color="teal" label="Ativar" onClick={() => bulk('available')} />
          <Button
            size="xs"
            color="slate"
            variant="ghost"
            label="Limpar"
            onClick={() => setSelected(new Set())}
          />
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-n-slate-11">{empty}</p>
      ) : (
        <ul aria-label="Itens" className="flex flex-col gap-2">
          {items.map((item, i) => (
            <ItemRow
              key={item.id}
              item={item}
              editable={editable}
              selected={selected.has(item.id)}
              canMoveUp={categoryId !== null && i > 0}
              canMoveDown={categoryId !== null && i < items.length - 1}
              onSelect={(on) => toggle(item.id, on)}
              onOpen={() => onOpen(item)}
              onStatus={(on) =>
                act(() => catalogApi.updateItem(item.id, { status: on ? 'available' : 'unavailable' }))
              }
              onDuplicate={() => act(() => catalogApi.duplicateItem(item.id))}
              onMove={(step) => act(() => catalogApi.reorderItems(categoryId!, moveId(items, i, step)))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
