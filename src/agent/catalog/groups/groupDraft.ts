import type { ComplementGroup, GroupDraft, GroupType } from '../types';
import type { OptionRowDraft } from './OptionRow';

export type GroupForm = Omit<GroupDraft, 'options'> & { options: OptionRowDraft[] };

export const newOption = (position: number): OptionRowDraft => ({
  product: { name: '' },
  price_cents: 0,
  original_price_cents: null,
  status: 'available',
  external_code: null,
  max_quantity: 1,
  position,
});

export function toGroupForm(group?: ComplementGroup, type: GroupType = 'ingredients'): GroupForm {
  return {
    name: group?.name || '',
    type: group?.type || type,
    external_code: group?.external_code ?? null,
    status: group?.status || 'available',
    options: group
      ? [...group.options]
          .sort((a, b) => a.position - b.position)
          .map((o) => ({
            id: o.id,
            product: { name: o.product.name },
            price_cents: o.price_cents,
            original_price_cents: o.original_price_cents,
            status: o.status,
            external_code: o.external_code,
            max_quantity: o.max_quantity,
            fractions: o.fractions,
            size_prices: o.size_prices,
            item_id: o.item_id,
            position: o.position,
            saved: o.product,
          }))
      : [newOption(0)],
  };
}

export function validateGroup(form: GroupForm): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push('Informe o nome do grupo.');
  if (!form.options.length) errors.push('Adicione pelo menos uma opção.');
  form.options.forEach((o, i) => {
    if (!o.product.name.trim()) errors.push(`Opção ${i + 1}: informe o nome.`);
    if (!(o.max_quantity >= 1)) errors.push(`Opção ${i + 1}: a quantidade máxima deve ser pelo menos 1.`);
  });
  return errors;
}

/** Body for POST/PATCH /catalog/groups (options replaced as a whole, in screen order). */
export const toGroupDraft = (form: GroupForm): GroupDraft => ({
  ...form,
  name: form.name.trim(),
  options: form.options.map(({ saved: _saved, ...o }, position) => ({
    ...o,
    product: { ...o.product, name: o.product.name.trim() },
    position,
  })),
});
