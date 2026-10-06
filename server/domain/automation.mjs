import { HelpdeskError } from './helpdesk.mjs';

/** Events, condition attributes and actions supported by automation rules (subset of Chatwoot's). */
export const AUTOMATION_EVENTS = [
  'conversation_created',
  'conversation_opened',
  'conversation_resolved',
  'message_created',
];
export const CONDITION_ATTRIBUTES = [
  'content',
  'message_type',
  'status',
  'inbox_id',
  'assignee_id',
  'team_id',
  'labels',
  'contact_phone',
  'contact_name',
];
export const OPERATORS = [
  'equal_to',
  'not_equal_to',
  'contains',
  'does_not_contain',
  'is_present',
  'is_not_present',
];
export const ACTIONS = [
  'assign_agent',
  'assign_team',
  'add_label',
  'remove_label',
  'send_message',
  'add_private_note',
  'resolve_conversation',
  'open_conversation',
  'set_priority',
];
const TEXT_ACTIONS = new Set(['send_message', 'add_private_note']);
const NO_PARAM_ACTIONS = new Set(['resolve_conversation', 'open_conversation']);

const norm = (v) => String(v ?? '').toLowerCase();
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function test({ filter_operator: op, values = [] }, actual) {
  const list = asList(actual).map(norm);
  const wanted = values.map(norm);
  switch (op) {
    case 'is_present':
      return list.some((v) => v !== '');
    case 'is_not_present':
      return !list.some((v) => v !== '');
    case 'equal_to':
      return wanted.some((w) => list.includes(w));
    case 'not_equal_to':
      return !wanted.some((w) => list.includes(w));
    case 'contains':
      return wanted.some((w) => list.some((v) => v.includes(w)));
    case 'does_not_contain':
      return !wanted.some((w) => list.some((v) => v.includes(w)));
    default:
      return false;
  }
}

/**
 * Evaluates conditions left to right; each condition's `query_operator` joins it to the next one,
 * exactly like Chatwoot's automation filters. No conditions means the rule always matches.
 */
export function matchesConditions(conditions, context) {
  if (!conditions.length) return true;
  let result = test(conditions[0], context[conditions[0].attribute_key]);
  for (let i = 1; i < conditions.length; i++) {
    const value = test(conditions[i], context[conditions[i].attribute_key]);
    result = conditions[i - 1].query_operator === 'or' ? result || value : result && value;
  }
  return result;
}

export function validateRule({ event_name, conditions, actions }) {
  if (!AUTOMATION_EVENTS.includes(event_name)) throw new HelpdeskError('Evento de automação inválido');
  for (const c of conditions) {
    if (!CONDITION_ATTRIBUTES.includes(c.attribute_key)) throw new HelpdeskError('Condição inválida');
    if (!OPERATORS.includes(c.filter_operator)) throw new HelpdeskError('Operador inválido');
    if (!['is_present', 'is_not_present'].includes(c.filter_operator) && !c.values?.length)
      throw new HelpdeskError('Informe um valor para a condição');
  }
  if (!actions.length) throw new HelpdeskError('Inclua ao menos uma ação');
  for (const a of actions) {
    if (!ACTIONS.includes(a.action_name)) throw new HelpdeskError('Ação inválida');
    if (!NO_PARAM_ACTIONS.has(a.action_name) && !a.action_params?.length)
      throw new HelpdeskError('Informe o parâmetro da ação');
    if (TEXT_ACTIONS.has(a.action_name) && !String(a.action_params[0]).trim())
      throw new HelpdeskError('A mensagem da automação não pode ser vazia');
  }
}

/** Maps helpdesk events to the automation event names they can trigger. */
export function automationEventsFor(event, data) {
  if (event === 'conversation.created') return ['conversation_created'];
  if (event === 'message.created' && data.message_type !== 'activity' && !data.private)
    return ['message_created'];
  if (event === 'conversation.status_changed') {
    if (data.status === 'resolved') return ['conversation_resolved'];
    if (data.status === 'open') return ['conversation_opened'];
  }
  return [];
}
