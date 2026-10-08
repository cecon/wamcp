import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { MoneyInput } from '../ui';
import type { PizzaDraft } from './pizzaDraft';

interface Props {
  pizza: PizzaDraft;
  onName: (topping: number, name: string) => void;
  onPrice: (topping: number, size: number, cents: number | null) => void;
  onAdd: () => void;
  onRemove: (topping: number) => void;
}

/** Flavors × sizes price grid. */
export function ToppingsGrid({ pizza, onName, onPrice, onAdd, onRemove }: Props) {
  const sizeName = (i: number) => pizza.sizes[i].name || `Tamanho ${i + 1}`;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label">Sabores e preço por tamanho</legend>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-n-slate-11">
              <th className="py-1 pr-2 font-medium">Sabor</th>
              {pizza.sizes.map((_, i) => (
                <th key={i} className="py-1 pr-2 font-medium">
                  {sizeName(i)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {pizza.toppings.map((t, ti) => (
              <tr key={`${ti}-${pizza.toppings.length}-${pizza.sizes.length}`}>
                <td className="py-1 pr-2">
                  <input
                    className="field !h-8 min-w-32"
                    aria-label={`Sabor ${ti + 1}`}
                    value={t.name}
                    onChange={(e) => onName(ti, e.target.value)}
                  />
                </td>
                {pizza.sizes.map((_, si) => (
                  <td key={si} className="py-1 pr-2">
                    <MoneyInput
                      compact
                      nullable
                      label={`Preço de ${t.name || `sabor ${ti + 1}`} (${sizeName(si)})`}
                      value={t.prices[si]}
                      onChange={(cents) => onPrice(ti, si, cents)}
                    />
                  </td>
                ))}
                <td>
                  <Button
                    size="xs"
                    color="ruby"
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`Remover sabor ${ti + 1}`}
                    onClick={() => onRemove(ti)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        size="xs"
        variant="faded"
        icon={Plus}
        label="Adicionar sabor"
        className="self-start"
        onClick={onAdd}
      />
    </fieldset>
  );
}
