import type { ExtraRow, PizzaDraft, SizeRow, ToppingRow } from './pizzaDraft';

/** [1, 2] → "1 ou 2 sabores"; [1] → "1 sabor". */
export function flavorsLabel(fractions: number[]) {
  if (!fractions.length) return 'nenhum sabor';
  const last = fractions[fractions.length - 1];
  const head = fractions.slice(0, -1).join(', ');
  return `${head ? `${head} ou ` : ''}${last} sabor${last > 1 || fractions.length > 1 ? 'es' : ''}`;
}

const replace = <T>(list: T[], i: number, patch: Partial<T>) =>
  list.map((x, j) => (i === j ? { ...x, ...patch } : x));

/** Immutable edits of the pizza draft; flavor prices stay aligned with the sizes. */
export const pizzaOps = {
  setSize: (p: PizzaDraft, i: number, patch: Partial<SizeRow>): PizzaDraft => ({
    ...p,
    sizes: replace(p.sizes, i, patch),
  }),
  addSize: (p: PizzaDraft): PizzaDraft => ({
    ...p,
    sizes: [...p.sizes, { name: '', price_cents: 0, slices: null, fractions: [1] }],
    toppings: p.toppings.map((t) => ({ ...t, prices: [...t.prices, null] })),
  }),
  removeSize: (p: PizzaDraft, i: number): PizzaDraft => ({
    ...p,
    sizes: p.sizes.filter((_, j) => j !== i),
    toppings: p.toppings.map((t) => ({ ...t, prices: t.prices.filter((_, j) => j !== i) })),
  }),
  setExtras: (p: PizzaDraft, kind: 'crusts' | 'edges', rows: ExtraRow[]): PizzaDraft => ({
    ...p,
    [kind]: rows,
  }),
  setTopping: (p: PizzaDraft, i: number, patch: Partial<ToppingRow>): PizzaDraft => ({
    ...p,
    toppings: replace(p.toppings, i, patch),
  }),
  setPrice: (p: PizzaDraft, topping: number, size: number, cents: number | null): PizzaDraft => ({
    ...p,
    toppings: p.toppings.map((t, j) =>
      j === topping ? { ...t, prices: t.prices.map((v, k) => (k === size ? cents : v)) } : t,
    ),
  }),
  addTopping: (p: PizzaDraft): PizzaDraft => ({
    ...p,
    toppings: [...p.toppings, { name: '', prices: p.sizes.map(() => null) }],
  }),
  removeTopping: (p: PizzaDraft, i: number): PizzaDraft => ({
    ...p,
    toppings: p.toppings.filter((_, j) => j !== i),
  }),
};
