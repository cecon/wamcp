import { Section } from '../ui';
import { ExtrasEditor } from './ExtrasEditor';
import type { PizzaDraft } from './pizzaDraft';
import { pizzaOps } from './pizzaOps';
import { SizesEditor } from './SizesEditor';
import { ToppingsGrid } from './ToppingsGrid';

interface Props {
  pizza: PizzaDraft;
  onChange: (pizza: PizzaDraft) => void;
}

/** Pizza: sizes (base price, slices, flavors), crusts and edges (surcharge) and the flavor price grid. */
export function PizzaSection({ pizza, onChange }: Props) {
  return (
    <Section title="Pizza">
      <p className="text-xs text-n-slate-11">
        Tamanhos, massas, bordas e sabores são compartilhados pelas pizzas desta categoria.
      </p>
      <SizesEditor
        sizes={pizza.sizes}
        onChange={(i, patch) => onChange(pizzaOps.setSize(pizza, i, patch))}
        onAdd={() => onChange(pizzaOps.addSize(pizza))}
        onRemove={(i) => onChange(pizzaOps.removeSize(pizza, i))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ExtrasEditor
          noun="Massa"
          legend="Massas"
          rows={pizza.crusts}
          onChange={(rows) => onChange(pizzaOps.setExtras(pizza, 'crusts', rows))}
        />
        <ExtrasEditor
          noun="Borda"
          legend="Bordas"
          rows={pizza.edges}
          onChange={(rows) => onChange(pizzaOps.setExtras(pizza, 'edges', rows))}
        />
      </div>
      <ToppingsGrid
        pizza={pizza}
        onName={(i, name) => onChange(pizzaOps.setTopping(pizza, i, { name }))}
        onPrice={(t, s, cents) => onChange(pizzaOps.setPrice(pizza, t, s, cents))}
        onAdd={() => onChange(pizzaOps.addTopping(pizza))}
        onRemove={(i) => onChange(pizzaOps.removeTopping(pizza, i))}
      />
    </Section>
  );
}
