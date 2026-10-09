import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { MoneyInput } from '../ui';
import { flavorsLabel } from './pizzaOps';
import type { SizeRow } from './pizzaDraft';

const FRACTIONS = [1, 2, 3, 4];

interface Props {
  sizes: SizeRow[];
  onChange: (index: number, patch: Partial<SizeRow>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/** Pizza sizes: name, base price, slices and how many flavors (fractions) each accepts. */
export function SizesEditor({ sizes, onChange, onAdd, onRemove }: Props) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label">Tamanhos</legend>
      {sizes.map((s, i) => (
        <div
          key={`${i}-${sizes.length}`}
          role="group"
          aria-label={`Tamanho ${i + 1}`}
          className="grid grid-cols-[1fr_8rem_5rem_auto] items-center gap-2 rounded-lg p-2 outline outline-1 -outline-offset-1 outline-n-weak"
        >
          <input
            className="field !h-8"
            aria-label={`Nome do tamanho ${i + 1}`}
            value={s.name}
            onChange={(e) => onChange(i, { name: e.target.value })}
          />
          <MoneyInput
            compact
            label={`Preço base do tamanho ${i + 1}`}
            value={s.price_cents}
            onChange={(cents) => onChange(i, { price_cents: cents ?? 0 })}
          />
          <input
            className="field !h-8 !px-2"
            type="number"
            min={1}
            aria-label={`Fatias do tamanho ${i + 1}`}
            placeholder="Fatias"
            value={s.slices ?? ''}
            onChange={(e) => onChange(i, { slices: e.target.value ? Number(e.target.value) : null })}
          />
          <Button
            size="xs"
            color="ruby"
            variant="ghost"
            icon={Trash2}
            aria-label={`Remover tamanho ${i + 1}`}
            onClick={() => onRemove(i)}
          />
          <div className="col-span-4 flex flex-wrap items-center gap-2 text-xs text-n-slate-11">
            Sabores:
            {FRACTIONS.map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`Tamanho ${i + 1} aceita ${n} sabor${n > 1 ? 'es' : ''}`}
                  checked={s.fractions.includes(n)}
                  onChange={(e) =>
                    onChange(i, {
                      fractions: e.target.checked
                        ? [...s.fractions, n].sort((a, b) => a - b)
                        : s.fractions.filter((f) => f !== n),
                    })
                  }
                />
                {n}
              </label>
            ))}
            <span className="text-n-slate-12">{flavorsLabel(s.fractions)}</span>
          </div>
        </div>
      ))}
      <Button
        size="xs"
        variant="faded"
        icon={Plus}
        label="Adicionar tamanho"
        className="self-start"
        onClick={onAdd}
      />
    </fieldset>
  );
}
