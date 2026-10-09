import type { CatalogItem, Dietary, GroupType, Serving, Template } from './types';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 2990 → "R$ 29,90" (non-breaking space normalized to a plain one). */
export const money = (cents: number) => BRL.format(cents / 100).replace(/\s/g, ' ');

/** "29,90", "29.90", "R$ 1.234,50" → cents; empty or invalid → null. */
export function parseMoney(text: string): number | null {
  let clean = text.replace(/[^\d,.]/g, '');
  if (!clean) return null;
  if (clean.includes(',')) clean = clean.replace(/\./g, '').replace(',', '.');
  const value = Number(clean);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Cents → editable text ("29,90"); null → "". */
export const moneyText = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');

export const TEMPLATE_LABEL: Record<Template, string> = {
  default: 'Padrão',
  pizza: 'Pizza',
  combo: 'Combo',
};

export const GROUP_TYPE_LABEL: Record<GroupType, string> = {
  ingredients: 'Ingredientes / adicionais',
  specification: 'Especificação (preparo)',
  offer_unit: 'Escolha de produtos',
  cutlery: 'Talheres',
  size: 'Tamanho (pizza)',
  crust: 'Massa (pizza)',
  edge: 'Borda (pizza)',
  topping: 'Sabores (pizza)',
  combo_main: 'Principal do combo',
};

export const SERVING_LABEL: Record<Serving, string> = {
  not_applicable: 'Não se aplica',
  serves_1: 'Serve 1 pessoa',
  serves_2: 'Serve 2 pessoas',
  serves_3: 'Serve 3 pessoas',
  serves_4: 'Serve 4 pessoas',
};

export const DIETARY_LABEL: Record<Dietary, string> = {
  vegetarian: 'Vegetariano',
  vegan: 'Vegano',
  organic: 'Orgânico',
  gluten_free: 'Sem glúten',
  sugar_free: 'Sem açúcar',
  lactose_free: 'Sem lactose',
  alcoholic: 'Bebida alcoólica',
  natural: 'Natural',
  zero: 'Zero',
  diet: 'Diet',
};

export const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Groups the pizza and combo sections manage themselves (hidden from the generic complements list). */
export const MANAGED_TYPES: GroupType[] = ['size', 'crust', 'edge', 'topping', 'combo_main'];

export const isRequired = (item: CatalogItem) => item.groups.some((g) => g.min >= 1);

/** "Calabresa — R$ 29,90" (pizzas start at the smallest size price). */
export function priceLabel(item: CatalogItem) {
  if (item.type !== 'pizza') return money(item.price_cents);
  const sizes = item.groups.find((g) => g.group.type === 'size')?.group.options || [];
  if (!sizes.length) return money(item.price_cents);
  return `a partir de ${money(Math.min(...sizes.map((o) => o.price_cents)))}`;
}
