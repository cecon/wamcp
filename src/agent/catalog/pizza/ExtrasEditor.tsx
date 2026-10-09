import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { MoneyInput } from '../ui';
import type { ExtraRow } from './pizzaDraft';

interface Props {
  /** "Massa" or "Borda". */
  noun: string;
  legend: string;
  rows: ExtraRow[];
  onChange: (rows: ExtraRow[]) => void;
}

/** Crusts or edges: name plus surcharge. */
export function ExtrasEditor({ noun, legend, rows, onChange }: Props) {
  const set = (i: number, patch: Partial<ExtraRow>) =>
    onChange(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label">{legend}</legend>
      {rows.length === 0 && <p className="text-xs text-n-slate-11">Nenhuma cadastrada.</p>}
      {rows.map((r, i) => (
        <div key={`${i}-${rows.length}`} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
          <input
            className="field !h-8"
            aria-label={`${noun} ${i + 1}`}
            value={r.name}
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <MoneyInput
            compact
            label={`Acréscimo de ${noun.toLowerCase()} ${i + 1}`}
            value={r.price_cents}
            onChange={(cents) => set(i, { price_cents: cents ?? 0 })}
          />
          <Button
            size="xs"
            color="ruby"
            variant="ghost"
            icon={Trash2}
            aria-label={`Remover ${noun.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="faded"
        icon={Plus}
        label={`Adicionar ${noun.toLowerCase()}`}
        className="self-start"
        onClick={() => onChange([...rows, { name: '', price_cents: 0 }])}
      />
    </fieldset>
  );
}
