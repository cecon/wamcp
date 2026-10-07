import type { AttributeDefinition, Catalog, FilterCondition, FilterType } from '../types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../labels';

export type FilterKind = 'text' | 'number' | 'date' | 'options' | 'boolean';
export interface FilterOption {
  value: string | number;
  label: string;
}
export interface FilterAttribute {
  key: string;
  label: string;
  kind: FilterKind;
  options?: FilterOption[];
}

/** Operators offered per value kind (the server rejects ordering operators on text). */
export const KIND_OPERATORS: Record<FilterKind, string[]> = {
  options: ['equal_to', 'not_equal_to', 'is_present', 'is_not_present'],
  text: ['equal_to', 'not_equal_to', 'contains', 'does_not_contain', 'is_present', 'is_not_present'],
  number: ['equal_to', 'not_equal_to', 'is_greater_than', 'is_less_than', 'is_present', 'is_not_present'],
  date: ['is_greater_than', 'is_less_than', 'days_before', 'is_present', 'is_not_present'],
  boolean: ['equal_to', 'not_equal_to'],
};
export const needsValue = (operator: string) => operator !== 'is_present' && operator !== 'is_not_present';

const opts = <T>(items: T[], value: (t: T) => string | number, label: (t: T) => string) =>
  items.map((t) => ({ value: value(t), label: label(t) }));

function customAttribute(d: AttributeDefinition): FilterAttribute {
  const key = `custom_attribute:${d.attribute_key}`;
  const label = d.attribute_display_name;
  switch (d.attribute_display_type) {
    case 'number':
    case 'currency':
    case 'percent':
      return { key, label, kind: 'number' };
    case 'date':
      return { key, label, kind: 'date' };
    case 'checkbox':
      return { key, label, kind: 'boolean' };
    case 'list':
      return { key, label, kind: 'options', options: opts(d.attribute_values, String, String) };
    default:
      return { key, label, kind: 'text' };
  }
}

/** Chatwoot filter attribute list for conversations or contacts, plus custom attributes. */
export function filterAttributes(
  type: FilterType,
  catalog: Catalog,
  definitions: AttributeDefinition[],
): FilterAttribute[] {
  const labels = { key: 'labels', label: 'Etiquetas', kind: 'options' as const };
  const labelOptions = opts(
    catalog.labels,
    (l) => l.title,
    (l) => l.title,
  );
  const builtin: FilterAttribute[] =
    type === 'contact'
      ? [
          { key: 'name', label: 'Nome', kind: 'text' },
          { key: 'phone_number', label: 'Telefone', kind: 'text' },
          { key: 'email', label: 'E-mail', kind: 'text' },
          { key: 'identifier', label: 'Identificador', kind: 'text' },
          { ...labels, options: labelOptions },
          { key: 'created_at', label: 'Criado em', kind: 'date' },
          { key: 'last_activity_at', label: 'Última atividade', kind: 'date' },
        ]
      : [
          {
            key: 'status',
            label: 'Status',
            kind: 'options',
            options: (['open', 'pending', 'snoozed', 'resolved'] as const).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
          {
            key: 'assignee_id',
            label: 'Agente atribuído',
            kind: 'options',
            options: opts(
              catalog.agents,
              (a) => a.id,
              (a) => a.name,
            ),
          },
          {
            key: 'inbox_id',
            label: 'Caixa de entrada',
            kind: 'options',
            options: opts(
              catalog.inboxes,
              (i) => i.id,
              (i) => i.name,
            ),
          },
          {
            key: 'team_id',
            label: 'Time',
            kind: 'options',
            options: opts(
              catalog.teams,
              (t) => t.id,
              (t) => t.name,
            ),
          },
          { ...labels, options: labelOptions },
          {
            key: 'priority',
            label: 'Prioridade',
            kind: 'options',
            options: Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label })),
          },
          { key: 'display_id', label: 'Número da conversa', kind: 'number' },
          { key: 'created_at', label: 'Criada em', kind: 'date' },
          { key: 'last_activity_at', label: 'Última atividade', kind: 'date' },
          { key: 'contact_name', label: 'Nome do contato', kind: 'text' },
          { key: 'contact_phone', label: 'Telefone do contato', kind: 'text' },
          { key: 'contact_email', label: 'E-mail do contato', kind: 'text' },
        ];
  return [...builtin, ...definitions.map(customAttribute)];
}

export const emptyCondition = (attribute: FilterAttribute): FilterCondition => ({
  attribute_key: attribute.key,
  filter_operator: KIND_OPERATORS[attribute.kind][0],
  values: [],
  query_operator: 'and',
});

/** Typed value of the value field: ids and numbers become numbers, booleans true/false. */
export function toValue(attribute: FilterAttribute | undefined, operator: string, raw: string) {
  if (!raw) return [];
  if (operator === 'days_before' || attribute?.kind === 'number') return [Number(raw)];
  if (attribute?.kind === 'boolean') return [raw === 'true'];
  const option = attribute?.options?.find((o) => String(o.value) === raw);
  return [option ? option.value : raw];
}
