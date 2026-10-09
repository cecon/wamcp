import { useState } from 'react';
import { ArrowDown, ArrowUp, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { cn } from '../../ui/cn';
import { catalogApi, moveId } from '../catalogApi';
import { TEMPLATE_LABEL } from '../format';
import type { Category } from '../types';
import { Badge } from '../ui';
import { CategoryModal } from './CategoryModal';

interface Props {
  categories: Category[];
  selectedId: number | null;
  editable: boolean;
  onSelect: (id: number) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** Left column of the menu: categories with reorder, pause, edit and delete (administrators). */
export function CategoryList({ categories, selectedId, editable, onSelect, onChanged, onError }: Props) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null),
    [deleting, setDeleting] = useState<Category | null>(null);
  const act = (action: () => Promise<unknown>) =>
    void action()
      .then(onChanged)
      .catch((e: Error) => onError(e.message));
  const icon = 'xs' as const;

  return (
    <nav aria-label="Categorias" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-heading-3 text-n-slate-12">Categorias</h2>
        {editable && (
          <Button
            size="xs"
            variant="faded"
            icon={Plus}
            label="Nova categoria"
            onClick={() => setEditing('new')}
          />
        )}
      </div>
      {categories.length === 0 && <p className="text-sm text-n-slate-11">Nenhuma categoria ainda.</p>}
      <ul className="flex flex-col gap-1">
        {categories.map((c, i) => {
          const paused = c.status === 'unavailable';
          return (
            <li
              key={c.id}
              className={cn(
                'group rounded-lg px-2 py-1.5 outline outline-1 -outline-offset-1',
                c.id === selectedId
                  ? 'bg-n-alpha-2 outline-n-strong'
                  : 'outline-transparent hover:bg-n-alpha-1',
              )}
            >
              <button
                type="button"
                aria-current={c.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(c.id)}
                className="flex w-full items-center gap-2 text-left text-sm"
              >
                <span
                  className={cn(
                    'flex-1 truncate font-medium',
                    paused ? 'text-n-slate-10' : 'text-n-slate-12',
                  )}
                >
                  {c.name}
                </span>
                <span className="text-xs text-n-slate-10">{c.items_count}</span>
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {c.template !== 'default' && <Badge tone="blue">{TEMPLATE_LABEL[c.template]}</Badge>}
                {paused && <Badge tone="amber">Pausada</Badge>}
                {editable && (
                  <span className="ml-auto flex gap-0.5">
                    <Button
                      size={icon}
                      color="slate"
                      variant="ghost"
                      icon={ArrowUp}
                      aria-label={`Mover ${c.name} para cima`}
                      disabled={i === 0}
                      onClick={() => act(() => catalogApi.reorderCategories(moveId(categories, i, -1)))}
                    />
                    <Button
                      size={icon}
                      color="slate"
                      variant="ghost"
                      icon={ArrowDown}
                      aria-label={`Mover ${c.name} para baixo`}
                      disabled={i === categories.length - 1}
                      onClick={() => act(() => catalogApi.reorderCategories(moveId(categories, i, 1)))}
                    />
                    <Button
                      size={icon}
                      color="slate"
                      variant="ghost"
                      icon={paused ? Play : Pause}
                      aria-label={`${paused ? 'Ativar' : 'Pausar'} ${c.name}`}
                      onClick={() =>
                        act(() =>
                          catalogApi.updateCategory(c.id, { status: paused ? 'available' : 'unavailable' }),
                        )
                      }
                    />
                    <Button
                      size={icon}
                      color="slate"
                      variant="ghost"
                      icon={Pencil}
                      aria-label={`Editar ${c.name}`}
                      onClick={() => setEditing(c)}
                    />
                    <Button
                      size={icon}
                      color="ruby"
                      variant="ghost"
                      icon={Trash2}
                      aria-label={`Excluir ${c.name}`}
                      onClick={() => setDeleting(c)}
                    />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <CategoryModal
          category={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            onChanged();
            onSelect(saved.id);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Excluir categoria"
          description={`Excluir “${deleting.name}”? Só é possível excluir categorias sem itens.`}
          confirm="Sim, excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await catalogApi.deleteCategory(deleting.id);
            onChanged();
          }}
        />
      )}
    </nav>
  );
}
