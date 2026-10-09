/* Product catalog (docs/catalog.md): values in cents, `status` available | unavailable. */

export type CatalogStatus = 'available' | 'unavailable';
export type Template = 'default' | 'pizza' | 'combo';
export type Serving = 'not_applicable' | 'serves_1' | 'serves_2' | 'serves_3' | 'serves_4';
export type Dietary =
  | 'vegetarian'
  | 'vegan'
  | 'organic'
  | 'gluten_free'
  | 'sugar_free'
  | 'lactose_free'
  | 'alcoholic'
  | 'natural'
  | 'zero'
  | 'diet';
export type GroupType =
  | 'ingredients'
  | 'specification'
  | 'offer_unit'
  | 'cutlery'
  | 'size'
  | 'crust'
  | 'edge'
  | 'topping'
  | 'combo_main';
export type PizzaPricing = 'greater' | 'average';

export interface Product {
  id: number;
  name: string;
  description: string | null;
  external_code: string | null;
  ean: string | null;
  serving: Serving;
  dietary: Dietary[];
  image_url: string | null;
  slices: number | null;
  ifood_id: string | null;
}

/** `days`: 0 = domingo … 6 = sábado; `end` before `start` crosses midnight. */
export interface Shift {
  days: number[];
  start: string;
  end: string;
}

export interface SizePrice {
  size_option_id: number;
  price_cents: number;
}

export interface GroupOption {
  id: number;
  product: Product;
  price_cents: number;
  original_price_cents: number | null;
  status: CatalogStatus;
  external_code: string | null;
  max_quantity: number;
  fractions: number[] | null;
  size_prices: SizePrice[] | null;
  item_id: number | null;
  position: number;
  ifood_id: string | null;
}

export interface ComplementGroup {
  id: number;
  name: string;
  type: GroupType;
  external_code: string | null;
  status: CatalogStatus;
  options: GroupOption[];
  used_by: number;
  ifood_id: string | null;
}

export interface GroupLink {
  group_id: number;
  min: number;
  max: number;
  position: number;
  group: ComplementGroup;
}

export interface CatalogItem {
  id: number;
  category_id: number;
  type: Template;
  product: Product;
  price_cents: number;
  original_price_cents: number | null;
  status: CatalogStatus;
  external_code: string | null;
  shifts: Shift[];
  position: number;
  groups: GroupLink[];
  available_now: boolean;
  ifood_id: string | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  template: Template;
  external_code: string | null;
  status: CatalogStatus;
  position: number;
  ifood_id: string | null;
  items_count: number;
}

export interface CatalogSettings {
  pizza_pricing: PizzaPricing;
  notes_max_length: number;
}

export interface Menu {
  settings: CatalogSettings;
  categories: (Category & { items: CatalogItem[] })[];
}

export interface QuoteChoice {
  option_id: number;
  quantity: number;
  choices: QuoteChoice[];
}

export interface Quote {
  unit_price_cents: number;
  total_price_cents: number;
  lines: { name: string; external_code: string | null; quantity: number; unit_price_cents: number }[];
  errors: string[];
}

export type ImportStatus =
  'starting' | 'opening' | 'waiting_human' | 'loading' | 'ready' | 'applied' | 'failed' | 'cancelled';

export interface PreviewGroup {
  name: string;
  type: GroupType;
  min: number;
  max: number;
  options: { name: string; price_cents: number }[];
}
export interface PreviewItem {
  name: string;
  price_cents: number;
  original_price_cents?: number | null;
  external_code?: string | null;
  groups: PreviewGroup[];
}
export interface PreviewCategory {
  name: string;
  template: Template;
  items: PreviewItem[];
}

export interface ImportJob {
  id: string;
  url: string;
  status: ImportStatus;
  message: string | null;
  started_at: number;
  counts: { categories: number; items: number; groups: number; options: number; images: number } | null;
  preview: { pizza_pricing: PizzaPricing; categories: PreviewCategory[] } | null;
}

/* Write payloads (POST/PATCH bodies). */

export type ProductDraft = Omit<Product, 'id' | 'image_url' | 'ifood_id'>;

export interface OptionDraft {
  id?: number;
  product: Pick<Product, 'name'> & Partial<ProductDraft>;
  price_cents: number;
  original_price_cents: number | null;
  status: CatalogStatus;
  external_code: string | null;
  max_quantity: number;
  fractions?: number[] | null;
  size_prices?: SizePrice[] | null;
  item_id?: number | null;
  position: number;
}

export interface GroupDraft {
  name: string;
  type: GroupType;
  external_code: string | null;
  status: CatalogStatus;
  options: OptionDraft[];
}

export interface LinkDraft {
  group_id: number;
  min: number;
  max: number;
  position: number;
}
