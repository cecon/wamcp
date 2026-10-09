import { cn } from '../../ui/cn';
import { DIETARY_LABEL, SERVING_LABEL } from '../format';
import type { Dietary, ProductDraft, Serving } from '../types';
import { Section, TextField } from '../ui';
import type { ItemDraft } from './itemDraft';

interface Props {
  draft: ItemDraft;
  onChange: (patch: Partial<ItemDraft>) => void;
}

/** Name, description, PDV code, EAN, serving and dietary tags. */
export function DetailsSection({ draft, onChange }: Props) {
  const product = draft.product;
  const setProduct = (patch: Partial<ProductDraft>) => onChange({ product: { ...product, ...patch } });
  const toggleDiet = (tag: Dietary) =>
    setProduct({
      dietary: product.dietary.includes(tag)
        ? product.dietary.filter((t) => t !== tag)
        : [...product.dietary, tag],
    });
  return (
    <Section title="Detalhes">
      <TextField
        label="Nome do item"
        value={product.name}
        max={120}
        onChange={(name) => setProduct({ name })}
      />
      <TextField
        label="Descrição"
        multiline
        max={1000}
        value={product.description || ''}
        onChange={(v) => setProduct({ description: v || null })}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Código PDV"
          max={60}
          value={draft.external_code || ''}
          onChange={(v) => onChange({ external_code: v.trim() || null })}
        />
        <TextField
          label="EAN"
          max={14}
          value={product.ean || ''}
          placeholder="Só números"
          onChange={(v) => setProduct({ ean: v.trim() || null })}
        />
        <label className="block">
          <span className="field-label">Serve</span>
          <select
            className="field"
            value={product.serving}
            onChange={(e) => setProduct({ serving: e.target.value as Serving })}
          >
            {Object.entries(SERVING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="field-label">Classificação alimentar</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(DIETARY_LABEL) as Dietary[]).map((tag) => {
            const on = product.dietary.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDiet(tag)}
                className={cn(
                  'h-7 rounded-full px-3 text-xs outline outline-1 -outline-offset-1 disabled:opacity-60',
                  on ? 'bg-n-brand/10 text-n-blue-11 outline-n-brand' : 'text-n-slate-11 outline-n-weak',
                )}
              >
                {DIETARY_LABEL[tag]}
              </button>
            );
          })}
        </div>
      </fieldset>
    </Section>
  );
}
