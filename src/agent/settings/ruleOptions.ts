import type { Action, AttributeDefinition, Catalog, Condition } from '../types';
import { PRIORITY_LABEL } from '../labels';

/** Shared inputs of the automation and macro editors (Chatwoot ConditionRow / ActionInput). */
export const small = 'field !h-8 !w-auto flex-1 basis-36 !py-1';
export const NO_VALUE = new Set(['is_present', 'is_not_present']);
export const NO_PARAM = new Set([
  'resolve_conversation',
  'open_conversation',
  'pending_conversation',
  'snooze_conversation',
  'mute_conversation',
  'remove_assigned_agent',
  'remove_assigned_team',
]);
export const TEXT_PARAM = new Set(['send_message', 'add_private_note']);
export const CUSTOM_PREFIX = 'custom_attribute:';

const STATUS: [string, string][] = [
  ['open', 'Aberta'],
  ['pending', 'Pendente'],
  ['resolved', 'Resolvida'],
  ['snoozed', 'Adiada'],
];
const PRIORITY_KEYS = new Set(['set_priority', 'change_priority', 'priority']);

/** Option lists for selects that pick catalog entities (or fixed values) instead of free text. */
export function choices(
  key: string,
  catalog: Catalog,
  definitions: AttributeDefinition[] = [],
): [string, string][] | null {
  if (key === 'assign_agent' || key === 'assignee_id')
    return catalog.agents.map((a) => [String(a.id), a.name]);
  if (key === 'assign_team' || key === 'team_id') return catalog.teams.map((t) => [String(t.id), t.name]);
  if (key === 'inbox_id') return catalog.inboxes.map((i) => [String(i.id), i.name]);
  if (key === 'add_label' || key === 'remove_label' || key === 'labels')
    return catalog.labels.map((l) => [l.title, l.title]);
  if (PRIORITY_KEYS.has(key)) return Object.entries(PRIORITY_LABEL);
  if (key === 'status') return STATUS;
  if (key === 'message_type')
    return [
      ['incoming', 'Recebida'],
      ['outgoing', 'Enviada'],
    ];
  const custom = key.startsWith(CUSTOM_PREFIX)
    ? definitions.find((d) => d.attribute_key === key.slice(CUSTOM_PREFIX.length))
    : undefined;
  if (custom?.attribute_display_type === 'list') return custom.attribute_values.map((v) => [v, v]);
  if (custom?.attribute_display_type === 'checkbox')
    return [
      ['true', 'Sim'],
      ['false', 'Não'],
    ];
  return null;
}

export const BOX = 'grid gap-4 rounded-xl p-3 outline outline-1 -outline-offset-1 outline-n-weak';

export const newAction = (): Action => ({ action_name: 'add_label', action_params: [] });
export const newCondition = (): Condition => ({
  attribute_key: 'content',
  filter_operator: 'contains',
  values: [],
  query_operator: 'and',
});
