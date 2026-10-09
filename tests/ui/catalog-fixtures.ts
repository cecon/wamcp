import type {
  CatalogItem,
  CatalogSettings,
  Category,
  ComplementGroup,
  GroupLink,
  GroupOption,
  ImportJob,
  Menu,
  Product,
} from '../../src/agent/catalog/types';
import type { Route } from './fake-api';

/* Catalog fixtures shaped exactly like docs/catalog.md. */

export const product = (id: number, name: string, fields: Partial<Product> = {}): Product => ({
  id,
  name,
  description: null,
  external_code: null,
  ean: null,
  serving: 'not_applicable',
  dietary: [],
  image_url: null,
  slices: null,
  ifood_id: null,
  ...fields,
});

export const option = (
  id: number,
  name: string,
  price: number,
  fields: Partial<GroupOption> = {},
): GroupOption => ({
  id,
  product: product(100 + id, name),
  price_cents: price,
  original_price_cents: null,
  status: 'available',
  external_code: null,
  max_quantity: 1,
  fractions: null,
  size_prices: null,
  item_id: null,
  position: 0,
  ifood_id: null,
  ...fields,
});

export const group = (id: number, name: string, fields: Partial<ComplementGroup> = {}): ComplementGroup => ({
  id,
  name,
  type: 'ingredients',
  external_code: null,
  status: 'available',
  options: [],
  used_by: 0,
  ifood_id: null,
  ...fields,
});

export const drinks = group(1, 'Escolha a bebida', {
  type: 'offer_unit',
  used_by: 1,
  options: [
    option(11, 'Coca-Cola', 600, { external_code: 'COCA' }),
    option(12, 'Guaraná', 500, { position: 1 }),
  ],
});
export const extras = group(2, 'Adicionais', {
  used_by: 2,
  options: [option(21, 'Bacon', 400, { max_quantity: 3 }), option(22, 'Cheddar', 300, { position: 1 })],
});
export const sauces = group(3, 'Molhos', { type: 'specification', options: [option(31, 'Barbecue', 0)] });

export const link = (g: ComplementGroup, min: number, max: number, position = 0): GroupLink => ({
  group_id: g.id,
  min,
  max,
  position,
  group: g,
});

export const item = (id: number, name: string, fields: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  category_id: 1,
  type: 'default',
  product: product(id, name),
  price_cents: 1000,
  original_price_cents: null,
  status: 'available',
  external_code: null,
  shifts: [],
  position: 0,
  groups: [],
  available_now: true,
  ifood_id: null,
  ...fields,
});

export const burger = item(10, 'X-Burger', {
  product: product(10, 'X-Burger', {
    description: 'Pão, carne e queijo',
    image_url: '/api/v1/catalog/images/xb.jpg',
  }),
  price_cents: 2990,
  original_price_cents: 3490,
  external_code: 'XB01',
  groups: [link(drinks, 1, 1), link(extras, 0, 3, 1)],
});
export const fries = item(11, 'Batata frita', {
  price_cents: 1500,
  status: 'unavailable',
  available_now: false,
  position: 1,
});
export const juice = item(12, 'Suco natural', {
  price_cents: 900,
  available_now: false,
  position: 2,
  shifts: [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }],
});

export const sizes = group(5, 'Tamanho', {
  type: 'size',
  options: [
    option(51, 'Média', 4990, { fractions: [1], product: product(151, 'Média', { slices: 6 }) }),
    option(52, 'Grande', 5990, {
      fractions: [1, 2],
      position: 1,
      product: product(152, 'Grande', { slices: 8 }),
    }),
  ],
});
export const crusts = group(6, 'Massa', { type: 'crust', options: [option(61, 'Tradicional', 0)] });
export const edges = group(7, 'Borda', { type: 'edge', options: [option(71, 'Catupiry', 800)] });
export const toppings = group(8, 'Sabores', {
  type: 'topping',
  options: [
    option(81, 'Calabresa', 0, {
      size_prices: [
        { size_option_id: 51, price_cents: 0 },
        { size_option_id: 52, price_cents: 500 },
      ],
    }),
  ],
});
export const calabresa = item(20, 'Calabresa', {
  category_id: 2,
  type: 'pizza',
  price_cents: 0,
  external_code: 'PZ01',
  groups: [link(sizes, 1, 1), link(crusts, 1, 1, 1), link(edges, 0, 1, 2), link(toppings, 1, 2, 3)],
});

export const category = (id: number, name: string, fields: Partial<Category> = {}): Category => ({
  id,
  name,
  description: null,
  template: 'default',
  external_code: null,
  status: 'available',
  position: id - 1,
  ifood_id: null,
  items_count: 0,
  ...fields,
});

export const settings: CatalogSettings = { pizza_pricing: 'greater', notes_max_length: 140 };
export const menu: Menu = {
  settings,
  categories: [
    { ...category(1, 'Lanches', { items_count: 3 }), items: [burger, fries, juice] },
    { ...category(2, 'Pizzas', { template: 'pizza', items_count: 1 }), items: [calabresa] },
    { ...category(3, 'Combos', { template: 'combo', status: 'unavailable' }), items: [] },
  ],
};
export const library = [drinks, extras, sauces, sizes, crusts, edges, toppings];

export const importJob = (fields: Partial<ImportJob> = {}): ImportJob => ({
  id: '7f3c',
  url: 'https://www.ifood.com.br/delivery/sao-paulo-sp/pizzaria-boa/abc123',
  status: 'starting',
  message: null,
  started_at: 1800000000,
  counts: null,
  preview: null,
  ...fields,
});
export const readyJob = importJob({
  status: 'ready',
  counts: { categories: 8, items: 64, groups: 21, options: 140, images: 58 },
  preview: {
    pizza_pricing: 'greater',
    categories: [
      {
        name: 'Pizzas',
        template: 'pizza',
        items: [
          {
            name: 'Calabresa',
            price_cents: 0,
            external_code: 'PZ01',
            groups: [
              {
                name: 'Tamanho',
                type: 'size',
                min: 1,
                max: 1,
                options: [{ name: 'Grande', price_cents: 5990 }],
              },
            ],
          },
        ],
      },
    ],
  },
});

/** Read routes of the catalog; tests add the write routes they exercise. */
export function catalogRoutes(): Record<string, Route> {
  return {
    'GET /catalog': menu,
    'GET /catalog/groups': library,
    'GET /catalog/settings': settings,
  };
}
