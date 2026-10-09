import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { Button } from '../../ui/Button';
import { useAction } from '../../settings/useAction';
import { catalogApi } from '../catalogApi';
import { money } from '../format';
import type { CatalogItem, GroupOption, Quote } from '../types';
import { Badge, ErrorList } from '../ui';

interface Props {
  item: CatalogItem;
  notesMax: number;
}

const range = (min: number, max: number) =>
  min === max ? `escolha ${min}` : min ? `escolha de ${min} a ${max}` : `até ${max}`;

/** Order simulator: pick options and quantities, then POST /catalog/quote (the same pricing the AI uses). */
export function Simulator({ item, notesMax }: Props) {
  const [quantity, setQuantity] = useState(1),
    [notes, setNotes] = useState(''),
    [picked, setPicked] = useState<Record<number, number>>({}),
    [quote, setQuote] = useState<Quote | null>(null);
  const { error, busy, run } = useAction();
  const groups = [...item.groups].sort((a, b) => a.position - b.position);
  const sizeIds = new Set(
    groups.filter((l) => l.group.type === 'size').flatMap((l) => l.group.options.map((o) => o.id)),
  );
  const size = Object.keys(picked)
    .map(Number)
    .find((id) => sizeIds.has(id) && picked[id] > 0);
  const price = (o: GroupOption) =>
    o.size_prices?.length
      ? (o.size_prices.find((p) => p.size_option_id === size)?.price_cents ?? null)
      : o.price_cents;
  const choose = (id: number, n: number) => setPicked((p) => ({ ...p, [id]: Math.max(0, n) }));
  const calculate = () =>
    void run(async () => {
      const choices = Object.entries(picked)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ option_id: Number(id), quantity: n, choices: [] }));
      setQuote(
        await catalogApi.quote({ item_id: item.id, quantity, notes: notes.trim() || undefined, choices }),
      );
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-n-slate-11">
        Monte um pedido de <strong className="text-n-slate-12">{item.product.name}</strong> para conferir o
        preço e as regras, exatamente como a IA e os agentes calculam.
      </p>
      {groups.map((l) => (
        <fieldset key={l.group_id} className="flex flex-col gap-1">
          <legend className="mb-1 flex items-center gap-2 text-sm font-medium text-n-slate-12">
            {l.group.name}
            <span className="text-xs font-normal text-n-slate-11">({range(l.min, l.max)})</span>
            {l.min >= 1 && <Badge tone="blue">Obrigatório</Badge>}
          </legend>
          {l.group.options.map((o) => {
            const value = picked[o.id] || 0;
            const cost = price(o);
            return (
              <label key={o.id} className="flex items-center gap-2 text-sm text-n-slate-12">
                {o.max_quantity > 1 ? (
                  <input
                    type="number"
                    min={0}
                    max={o.max_quantity}
                    className="field !h-7 !w-16 !px-2"
                    aria-label={`Quantidade de ${o.product.name}`}
                    value={value}
                    onChange={(e) => choose(o.id, Number(e.target.value))}
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={value > 0}
                    onChange={(e) => choose(o.id, e.target.checked ? 1 : 0)}
                  />
                )}
                <span className="flex-1">{o.product.name}</span>
                <span className="text-xs text-n-slate-11">{cost == null ? '—' : `+ ${money(cost)}`}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <label className="block">
          <span className="field-label">Quantidade</span>
          <input
            type="number"
            min={1}
            className="field"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className="field-label">
            Observações ({notes.length}/{notesMax})
          </span>
          <input
            className="field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="sem cebola"
          />
        </label>
      </div>
      <Button icon={Calculator} label="Calcular" className="self-start" disabled={busy} onClick={calculate} />
      {error && <ErrorList errors={[error]} />}
      {quote && (
        <div aria-label="Resultado do cálculo" className="flex flex-col gap-2 rounded-xl bg-n-slate-2 p-3">
          <ErrorList errors={quote.errors} />
          <ul className="flex flex-col gap-1 text-sm">
            {quote.lines.map((line, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {line.quantity}× {line.name}
                  {line.external_code && (
                    <span className="ml-1 text-xs text-n-slate-10">PDV {line.external_code}</span>
                  )}
                </span>
                <span>{money(line.unit_price_cents * line.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-n-weak pt-2 text-sm">
            <span className="text-n-slate-11">Unitário {money(quote.unit_price_cents)}</span>
            <strong className="text-n-slate-12">Total {money(quote.total_price_cents)}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
