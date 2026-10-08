import { catalogApi } from '../catalogApi';
import { MANAGED_TYPES } from '../format';
import { emptyPizza, pizzaFromLinks, savePizza, validatePizza, type PizzaDraft } from '../pizza/pizzaDraft';
import type {
  CatalogItem,
  CatalogStatus,
  Category,
  ComplementGroup,
  LinkDraft,
  Menu,
  Product,
  ProductDraft,
  Shift,
} from '../types';

export type EditorLink = LinkDraft & { group: ComplementGroup };
export interface ComboEntry {
  id?: number;
  item_id: number;
  name: string;
  price_cents: number;
}
export interface ComboDraft {
  groupId?: number;
  entries: ComboEntry[];
}
export interface ItemDraft {
  product: ProductDraft;
  price_cents: number;
  original_price_cents: number | null;
  status: CatalogStatus;
  external_code: string | null;
  shifts: Shift[];
  /** Ordinary complements (pizza and combo groups live in `pizza` / `combo`). */
  links: EditorLink[];
  pizza: PizzaDraft | null;
  combo: ComboDraft | null;
}

const EMPTY_PRODUCT: ProductDraft = {
  name: '',
  description: null,
  external_code: null,
  ean: null,
  serving: 'not_applicable',
  dietary: [],
  slices: null,
};

const productDraft = (p?: Product): ProductDraft =>
  p
    ? {
        name: p.name,
        description: p.description,
        external_code: p.external_code,
        ean: p.ean,
        serving: p.serving,
        dietary: p.dietary,
        slices: p.slices,
      }
    : EMPTY_PRODUCT;

function comboFrom(item?: CatalogItem): ComboDraft {
  const main = item?.groups.find((l) => l.group.type === 'combo_main')?.group;
  return {
    groupId: main?.id,
    entries: (main?.options || [])
      .filter((o) => o.item_id != null)
      .map((o) => ({ id: o.id, item_id: o.item_id!, name: o.product.name, price_cents: o.price_cents })),
  };
}

/** Editable copy of an item; a new pizza reuses the groups of the category's other pizzas. */
export function toDraft(item: CatalogItem | undefined, category: Category, menu: Menu): ItemDraft {
  const siblings = menu.categories.find((c) => c.id === category.id)?.items || [];
  const pizzaSource = item || siblings.find((i) => i.groups.some((l) => l.group.type === 'size'));
  return {
    product: productDraft(item?.product),
    price_cents: item?.price_cents ?? 0,
    original_price_cents: item?.original_price_cents ?? null,
    status: item?.status || 'available',
    external_code: item?.external_code ?? null,
    shifts: item?.shifts || [],
    links: (item?.groups || [])
      .filter((l) => !MANAGED_TYPES.includes(l.group.type))
      .map(({ group_id, min, max, position, group }) => ({ group_id, min, max, position, group })),
    pizza:
      category.template === 'pizza'
        ? pizzaSource
          ? pizzaFromLinks(pizzaSource.groups)
          : emptyPizza()
        : null,
    combo: category.template === 'combo' ? comboFrom(item) : null,
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Client-side checks mirroring docs/catalog.md (the server validates again). */
export function validateItem(d: ItemDraft): string[] {
  const errors: string[] = [];
  if (!d.product.name.trim()) errors.push('Informe o nome do item.');
  if (d.product.ean && !/^\d{1,14}$/.test(d.product.ean))
    errors.push('O EAN deve ter até 14 dígitos (só números).');
  if (!d.pizza && d.original_price_cents != null && d.original_price_cents <= d.price_cents)
    errors.push('O preço “de” deve ser maior que o preço “por”.');
  d.shifts.forEach((s, i) => {
    if (!s.days.length) errors.push(`Horário ${i + 1}: escolha pelo menos um dia.`);
    if (!TIME.test(s.start) || !TIME.test(s.end)) errors.push(`Horário ${i + 1}: use o formato HH:MM.`);
    else if (s.start === s.end) errors.push(`Horário ${i + 1}: início e fim não podem ser iguais.`);
  });
  for (const l of d.links) {
    if (l.min < 0) errors.push(`“${l.group.name}”: o mínimo não pode ser negativo.`);
    if (l.max < 1) errors.push(`“${l.group.name}”: o máximo deve ser pelo menos 1.`);
    else if (l.max < l.min) errors.push(`“${l.group.name}”: o máximo deve ser maior ou igual ao mínimo.`);
  }
  if (d.pizza) errors.push(...validatePizza(d.pizza));
  if (d.combo && !d.combo.entries.length) errors.push('Escolha pelo menos um item para o combo.');
  return errors;
}

async function saveCombo(combo: ComboDraft): Promise<LinkDraft> {
  const draft = {
    name: 'Escolha o item principal',
    type: 'combo_main' as const,
    external_code: null,
    status: 'available' as const,
    options: combo.entries.map((e, position) => ({
      id: e.id,
      product: { name: e.name },
      price_cents: e.price_cents,
      original_price_cents: null,
      status: 'available' as const,
      external_code: null,
      max_quantity: 1,
      item_id: e.item_id,
      position,
    })),
  };
  const group = combo.groupId
    ? await catalogApi.updateGroup(combo.groupId, draft)
    : await catalogApi.createGroup(draft);
  return { group_id: group.id, min: 1, max: 1, position: 0 };
}

/** Saves the pizza/combo groups, then creates or updates the item with all its links. */
export async function saveItem(d: ItemDraft, category: Category, item?: CatalogItem) {
  const managed = d.pizza ? await savePizza(d.pizza) : d.combo ? [await saveCombo(d.combo)] : [];
  const groups = [...managed, ...d.links].map(({ group_id, min, max }, position) => ({
    group_id,
    min,
    max,
    position,
  }));
  const body = {
    product: { ...d.product, name: d.product.name.trim() },
    price_cents: d.pizza ? 0 : d.price_cents,
    original_price_cents: d.pizza ? null : d.original_price_cents,
    status: d.status,
    external_code: d.external_code,
    shifts: d.shifts,
    groups,
  };
  return item
    ? catalogApi.updateItem(item.id, body)
    : catalogApi.createItem({ ...body, category_id: category.id, type: category.template });
}
