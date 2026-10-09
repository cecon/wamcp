import { http, upload } from '../api';
import type {
  CatalogItem,
  CatalogSettings,
  CatalogStatus,
  Category,
  ComplementGroup,
  GroupDraft,
  ImportJob,
  Product,
  Quote,
  QuoteChoice,
} from './types';

export type CategoryDraft = Pick<Category, 'name' | 'description' | 'template' | 'external_code'> &
  Partial<Pick<Category, 'status'>>;

/** Typed calls to /api/v1/catalog (docs/catalog.md). */
export const catalogApi = {
  saveSettings: (settings: CatalogSettings) => http<CatalogSettings>('/catalog/settings', 'PATCH', settings),

  createCategory: (draft: CategoryDraft) => http<Category>('/catalog/categories', 'POST', draft),
  updateCategory: (id: number, patch: Partial<CategoryDraft>) =>
    http<Category>(`/catalog/categories/${id}`, 'PATCH', patch),
  deleteCategory: (id: number) => http(`/catalog/categories/${id}`, 'DELETE'),
  reorderCategories: (ids: number[]) => http('/catalog/categories/reorder', 'POST', { ids }),

  createItem: (body: object) => http<CatalogItem>('/catalog/items', 'POST', body),
  updateItem: (id: number, patch: object) => http<CatalogItem>(`/catalog/items/${id}`, 'PATCH', patch),
  deleteItem: (id: number) => http(`/catalog/items/${id}`, 'DELETE'),
  duplicateItem: (id: number) => http<CatalogItem>(`/catalog/items/${id}/duplicate`, 'POST'),
  reorderItems: (category_id: number, ids: number[]) =>
    http('/catalog/items/reorder', 'POST', { category_id, ids }),
  setItemsStatus: (ids: number[], status: CatalogStatus) =>
    http('/catalog/items/status', 'POST', { ids, status }),

  createGroup: (draft: GroupDraft) => http<ComplementGroup>('/catalog/groups', 'POST', draft),
  updateGroup: (id: number, patch: Partial<GroupDraft>) =>
    http<ComplementGroup>(`/catalog/groups/${id}`, 'PATCH', patch),
  deleteGroup: (id: number) => http(`/catalog/groups/${id}`, 'DELETE'),

  uploadImage: (productId: number, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return upload<Product>(`/catalog/products/${productId}/image`, form);
  },
  removeImage: (productId: number) => http(`/catalog/products/${productId}/image`, 'DELETE'),

  quote: (body: { item_id: number; quantity: number; notes?: string; choices: QuoteChoice[] }) =>
    http<Quote>('/catalog/quote', 'POST', body),

  startImport: (url: string) => http<ImportJob>('/catalog/imports', 'POST', { url }),
  importJob: (id: string) => http<ImportJob>(`/catalog/imports/${id}`),
  applyImport: (id: string, mode: 'merge' | 'replace') =>
    http<ImportJob>(`/catalog/imports/${id}/apply`, 'POST', { mode }),
  cancelImport: (id: string) => http(`/catalog/imports/${id}`, 'DELETE'),
};

/** Moves `list[index]` one step up (-1) or down (+1); returns the new id order. */
export function moveId<T extends { id: number }>(list: T[], index: number, step: -1 | 1) {
  const ids = list.map((x) => x.id);
  const target = index + step;
  if (target < 0 || target >= ids.length) return ids;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}
