import type { CatalogStatus } from '../types';
import { MoneyInput, Section } from '../ui';
import type { ItemDraft } from './itemDraft';
import { ShiftsEditor } from './ShiftsEditor';

interface Props {
  draft: ItemDraft;
  onChange: (patch: Partial<ItemDraft>) => void;
}

/** Price "por" / "de", status and availability shifts (pizza prices come from the sizes). */
export function PriceSection({ draft, onChange }: Props) {
  return (
    <Section title="Preço e disponibilidade">
      {draft.pizza ? (
        <p className="text-sm text-n-slate-11">O preço da pizza vem do tamanho e dos sabores escolhidos.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput
            label="Preço"
            value={draft.price_cents}
            onChange={(cents) => onChange({ price_cents: cents ?? 0 })}
          />
          <MoneyInput
            label="Preço “de” (promoção)"
            nullable
            value={draft.original_price_cents}
            onChange={(cents) => onChange({ original_price_cents: cents })}
          />
        </div>
      )}
      <label className="block">
        <span className="field-label">Status</span>
        <select
          className="field"
          value={draft.status}
          onChange={(e) => onChange({ status: e.target.value as CatalogStatus })}
        >
          <option value="available">Disponível</option>
          <option value="unavailable">Pausado / esgotado</option>
        </select>
      </label>
      <ShiftsEditor shifts={draft.shifts} onChange={(shifts) => onChange({ shifts })} />
    </Section>
  );
}
