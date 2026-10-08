import { useState } from 'react';
import { Plus } from 'lucide-react';
import { query, type Realtime } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { SettingsHeader } from '../../ui/Settings';
import { ItemEditor } from '../editor/ItemEditor';
import type { CatalogItem } from '../types';
import { useMenu } from '../useMenu';
import { CategoryList } from './CategoryList';
import { ItemList } from './ItemList';

type StatusFilter = 'all' | 'available' | 'unavailable' | 'off_hours';
const FILTERS: [StatusFilter, string][] = [
  ['all', 'Todos os status'],
  ['available', 'Disponíveis agora'],
  ['unavailable', 'Pausados'],
  ['off_hours', 'Fora do horário'],
];
function matches(item: CatalogItem, filter: StatusFilter) {
  if (filter === 'unavailable') return item.status === 'unavailable';
  if (filter === 'available') return item.status === 'available' && item.available_now;
  if (filter === 'off_hours') return item.status === 'available' && !item.available_now;
  return true;
}

/** Catálogo → Cardápio: categories on the left, the selected category's items on the right. */
export function MenuPage({ editable, realtime }: { editable: boolean; realtime?: Realtime }) {
  const { menu, error: loadError, reload } = useMenu(realtime);
  const [picked, setPicked] = useState<number | null>(null),
    [q, setQ] = useState(''),
    [filter, setFilter] = useState<StatusFilter>('all'),
    [editing, setEditing] = useState<CatalogItem | 'new' | null>(null),
    [error, setError] = useState('');
  const term = q.trim();
  const searching = term.length >= 2;
  const search = useFetch<CatalogItem[]>(searching ? `/catalog/search${query({ q: term })}` : null);
  const categories = menu?.categories || [];
  const category = categories.find((c) => c.id === picked) || categories[0] || null;
  const source = searching ? search.data || [] : category?.items || [];
  const items = source.filter((i) => matches(i, filter));
  const editingCategory =
    editing && editing !== 'new'
      ? categories.find((c) => c.id === editing.category_id) || category
      : category;
  const changed = () => {
    setError('');
    reload();
    if (searching) search.reload();
  };

  return (
    <div className="h-full w-full overflow-auto bg-n-surface-1 px-6 pt-4 pb-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <SettingsHeader
          title="Cardápio"
          description={
            editable
              ? 'Categorias, itens, preços, complementos e horários que a IA e os agentes usam para atender pedidos.'
              : 'Consulte itens, preços e complementos. Somente administradores podem alterar o cardápio.'
          }
          search={{ value: q, onChange: setQ, placeholder: 'Buscar itens por nome ou código…' }}
          action={
            <div className="flex items-center gap-2">
              <select
                aria-label="Filtrar por status"
                className="field !h-8 !w-44 !py-0"
                value={filter}
                onChange={(e) => setFilter(e.target.value as StatusFilter)}
              >
                {FILTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {editable && (
                <Button
                  icon={Plus}
                  label="Novo item"
                  disabled={!category}
                  onClick={() => setEditing('new')}
                />
              )}
            </div>
          }
        />
        {(loadError || error || search.error) && (
          <p role="alert" className="text-sm text-n-ruby-11">
            {error || loadError || search.error}
          </p>
        )}
        {!menu && !loadError && <p className="text-sm text-n-slate-11">Carregando cardápio…</p>}
        {menu && (
          <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
            <CategoryList
              categories={categories}
              selectedId={category?.id ?? null}
              editable={editable}
              onSelect={(id) => {
                setPicked(id);
                setQ('');
              }}
              onChanged={changed}
              onError={setError}
            />
            <section aria-label={searching ? 'Resultados da busca' : category?.name || 'Itens'}>
              <h2 className="text-heading-3 mb-2 text-n-slate-12">
                {searching ? `Resultados para “${term}”` : category?.name || 'Itens'}
              </h2>
              <ItemList
                key={searching ? 'search' : category?.id}
                items={items}
                categoryId={!searching && filter === 'all' ? (category?.id ?? null) : null}
                editable={editable}
                empty={searching ? 'Nenhum item encontrado.' : 'Nenhum item nesta categoria.'}
                onOpen={setEditing}
                onChanged={changed}
                onError={setError}
              />
            </section>
          </div>
        )}
      </div>
      {editing && editingCategory && menu && (
        <ItemEditor
          item={editing === 'new' ? undefined : editing}
          category={editingCategory}
          menu={menu}
          editable={editable}
          onSaved={changed}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
