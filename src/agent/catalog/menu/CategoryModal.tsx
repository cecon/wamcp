import { useState } from 'react';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../../settings/useAction';
import { catalogApi, type CategoryDraft } from '../catalogApi';
import { TEMPLATE_LABEL } from '../format';
import type { Category, Template } from '../types';
import { TextField } from '../ui';

interface Props {
  category?: Category;
  onSaved: (category: Category) => void;
  onClose: () => void;
}

/** Create or edit a category: name, description, template (only while empty) and PDV code. */
export function CategoryModal({ category, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<CategoryDraft>({
    name: category?.name || '',
    description: category?.description || null,
    template: category?.template || 'default',
    external_code: category?.external_code || null,
  });
  const { error, busy, run } = useAction();
  const lockedTemplate = Boolean(category?.items_count);
  const set = (patch: Partial<CategoryDraft>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Modal title={category ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = { ...draft, name: draft.name.trim() };
            onSaved(
              category
                ? await catalogApi.updateCategory(category.id, body)
                : await catalogApi.createCategory(body),
            );
            onClose();
          });
        }}
      >
        <TextField
          label="Nome da categoria"
          value={draft.name}
          max={80}
          required
          onChange={(name) => set({ name })}
        />
        <TextField
          label="Descrição"
          multiline
          max={500}
          value={draft.description || ''}
          onChange={(v) => set({ description: v || null })}
        />
        <label className="block">
          <span className="field-label">Modelo</span>
          <select
            className="field"
            value={draft.template}
            disabled={lockedTemplate}
            onChange={(e) => set({ template: e.target.value as Template })}
          >
            {Object.entries(TEMPLATE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {lockedTemplate && (
          <p className="-mt-3 text-xs text-n-slate-11">
            O modelo só pode mudar enquanto a categoria estiver vazia.
          </p>
        )}
        <TextField
          label="Código PDV"
          max={60}
          value={draft.external_code || ''}
          onChange={(v) => set({ external_code: v.trim() || null })}
        />
        <ModalFooter busy={busy} submit={category ? 'Salvar' : 'Criar'} onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
