import { catalogApi } from '../catalogApi';
import type { ComplementGroup, GroupDraft, GroupLink, GroupType, LinkDraft, OptionDraft } from '../types';

export interface SizeRow {
  id?: number;
  name: string;
  price_cents: number;
  slices: number | null;
  fractions: number[];
}
export interface ExtraRow {
  id?: number;
  name: string;
  price_cents: number;
}
/** A flavor with its price in each size (aligned with `sizes`; null = not informed). */
export interface ToppingRow {
  id?: number;
  name: string;
  prices: (number | null)[];
}
type PizzaGroup = 'size' | 'crust' | 'edge' | 'topping';
export interface PizzaDraft {
  groupIds: Partial<Record<PizzaGroup, number>>;
  sizes: SizeRow[];
  crusts: ExtraRow[];
  edges: ExtraRow[];
  toppings: ToppingRow[];
}

const byPosition = <T extends { position: number }>(list: T[]) =>
  [...list].sort((a, b) => a.position - b.position);
const find = (links: GroupLink[], type: GroupType) => links.find((l) => l.group.type === type)?.group;
const extras = (group?: ComplementGroup): ExtraRow[] =>
  byPosition(group?.options || []).map((o) => ({
    id: o.id,
    name: o.product.name,
    price_cents: o.price_cents,
  }));

/** Reads the four pizza groups (size, crust, edge, topping) of an item into an editable draft. */
export function pizzaFromLinks(links: GroupLink[]): PizzaDraft {
  const size = find(links, 'size'),
    crust = find(links, 'crust'),
    edge = find(links, 'edge'),
    topping = find(links, 'topping');
  const sizes = byPosition(size?.options || []);
  return {
    groupIds: { size: size?.id, crust: crust?.id, edge: edge?.id, topping: topping?.id },
    sizes: sizes.map((o) => ({
      id: o.id,
      name: o.product.name,
      price_cents: o.price_cents,
      slices: o.product.slices,
      fractions: o.fractions || [1],
    })),
    crusts: extras(crust),
    edges: extras(edge),
    toppings: byPosition(topping?.options || []).map((o) => ({
      id: o.id,
      name: o.product.name,
      prices: sizes.map((s) => o.size_prices?.find((p) => p.size_option_id === s.id)?.price_cents ?? null),
    })),
  };
}

export const emptyPizza = (): PizzaDraft => ({
  groupIds: {},
  sizes: [{ name: 'Grande', price_cents: 0, slices: 8, fractions: [1, 2] }],
  crusts: [{ name: 'Tradicional', price_cents: 0 }],
  edges: [],
  toppings: [],
});

export function validatePizza(p: PizzaDraft): string[] {
  const errors: string[] = [];
  if (!p.sizes.length) errors.push('Cadastre pelo menos um tamanho de pizza.');
  if (p.sizes.some((s) => !s.name.trim())) errors.push('Todo tamanho precisa de um nome.');
  if (p.sizes.some((s) => !s.fractions.length))
    errors.push('Cada tamanho precisa aceitar pelo menos 1 sabor.');
  if ([...p.crusts, ...p.edges].some((x) => !x.name.trim())) errors.push('Massas e bordas precisam de nome.');
  if (!p.toppings.length) errors.push('Cadastre pelo menos um sabor.');
  for (const t of p.toppings) {
    if (!t.name.trim()) errors.push('Todo sabor precisa de um nome.');
    else if (p.sizes.some((_, i) => t.prices[i] == null))
      errors.push(`Informe o preço do sabor “${t.name}” em todos os tamanhos.`);
  }
  return errors;
}

const option = (
  position: number,
  fields: Partial<OptionDraft> & Pick<OptionDraft, 'product'>,
): OptionDraft => ({
  price_cents: 0,
  original_price_cents: null,
  status: 'available',
  external_code: null,
  max_quantity: 1,
  position,
  ...fields,
});

const upsert = (id: number | undefined, draft: GroupDraft) =>
  id ? catalogApi.updateGroup(id, draft) : catalogApi.createGroup(draft);
const group = (name: string, type: GroupType, options: OptionDraft[]): GroupDraft => ({
  name,
  type,
  external_code: null,
  status: 'available',
  options,
});

/** Saves the pizza groups (size first: flavors price by its option ids) and returns the item links. */
export async function savePizza(p: PizzaDraft): Promise<LinkDraft[]> {
  const size = await upsert(
    p.groupIds.size,
    group(
      'Tamanho',
      'size',
      p.sizes.map((s, i) =>
        option(i, {
          id: s.id,
          product: { name: s.name, slices: s.slices },
          price_cents: s.price_cents,
          fractions: s.fractions,
        }),
      ),
    ),
  );
  const sizeIds = byPosition(size.options).map((o) => o.id);
  const links: LinkDraft[] = [{ group_id: size.id, min: 1, max: 1, position: 0 }];
  const extra = async (rows: ExtraRow[], name: string, type: PizzaGroup, min: number) => {
    if (!rows.length) return;
    const saved = await upsert(
      p.groupIds[type],
      group(
        name,
        type,
        rows.map((r, i) => option(i, { id: r.id, product: { name: r.name }, price_cents: r.price_cents })),
      ),
    );
    links.push({ group_id: saved.id, min, max: 1, position: links.length });
  };
  await extra(p.crusts, 'Massa', 'crust', 1);
  await extra(p.edges, 'Borda', 'edge', 0);
  const toppings = await upsert(
    p.groupIds.topping,
    group(
      'Sabores',
      'topping',
      p.toppings.map((t, i) =>
        option(i, {
          id: t.id,
          product: { name: t.name },
          size_prices: sizeIds.map((size_option_id, k) => ({
            size_option_id,
            price_cents: t.prices[k] ?? 0,
          })),
        }),
      ),
    ),
  );
  const flavors = Math.max(1, ...p.sizes.flatMap((s) => s.fractions));
  links.push({ group_id: toppings.id, min: 1, max: flavors, position: links.length });
  return links;
}
