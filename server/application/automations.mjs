import { HelpdeskError, requireAdmin } from '../domain/helpdesk.mjs';
import { automationEventsFor, matchesConditions, validateRule } from '../domain/automation.mjs';
import { systemActor } from './conversation-core.mjs';

/**
 * Automation rules (Chatwoot's AutomationRuleListener): when an event matches a rule's conditions,
 * its actions run through the regular use cases as an "automation" actor. Events caused by
 * automations never trigger rules again, which prevents loops.
 */
export function automationService({ helpdesk, conversations, bus }) {
  const find = (id) => {
    const rule = helpdesk.automationRule(id);
    if (!rule) throw new HelpdeskError('Automação não encontrada', 404);
    return rule;
  };
  function context(conversation, message) {
    return {
      content: message?.content ?? null,
      message_type: message?.message_type ?? null,
      status: conversation.status,
      inbox_id: String(conversation.inbox_id),
      assignee_id: conversation.assignee_id == null ? null : String(conversation.assignee_id),
      team_id: conversation.team_id == null ? null : String(conversation.team_id),
      labels: conversation.labels,
      contact_phone: conversation.contact_phone,
      contact_name: conversation.contact_name,
    };
  }
  async function run(rule, conversation) {
    const actor = systemActor('automation', `Automação “${rule.name}”`);
    const id = conversation.display_id;
    for (const { action_name: action, action_params: params = [] } of rule.actions) {
      try {
        const current = helpdesk.conversationById(conversation.id);
        if (action === 'assign_agent') conversations.assign(actor, id, { assignee_id: Number(params[0]) });
        else if (action === 'assign_team') conversations.assign(actor, id, { team_id: Number(params[0]) });
        else if (action === 'add_label')
          conversations.setLabels(actor, id, [...new Set([...current.labels, ...params])]);
        else if (action === 'remove_label')
          conversations.setLabels(
            actor,
            id,
            current.labels.filter((l) => !params.includes(l)),
          );
        else if (action === 'send_message') await conversations.reply(actor, id, { content: params[0] });
        else if (action === 'add_private_note')
          await conversations.reply(actor, id, { content: params[0], private: true });
        else if (action === 'resolve_conversation')
          conversations.toggleStatus(actor, id, { status: 'resolved' });
        else if (action === 'open_conversation') conversations.toggleStatus(actor, id, { status: 'open' });
        else if (action === 'set_priority') conversations.setPriority(actor, id, params[0]);
      } catch {
        // One failing action (e.g. an agent removed from the inbox) must not stop the others.
      }
    }
  }
  async function onEvent({ event, data, performer }) {
    if (performer?.type === 'automation') return;
    for (const name of automationEventsFor(event, data)) {
      const conversationId = event === 'message.created' ? data.conversation_id : data.id;
      const conversation = helpdesk.conversationById(conversationId);
      if (!conversation) continue;
      const message = event === 'message.created' ? data : null;
      for (const rule of helpdesk.activeRules(name))
        if (matchesConditions(rule.conditions, context(conversation, message))) await run(rule, conversation);
    }
  }
  return {
    listen() {
      let queue = Promise.resolve();
      // Rules run one event at a time, in order, after the triggering commit.
      return bus.subscribe((envelope) => {
        queue = queue.then(() => onEvent(envelope)).catch(() => {});
      });
    },
    list(actor) {
      requireAdmin(actor);
      return helpdesk.automationRules();
    },
    create(actor, rule) {
      requireAdmin(actor);
      validateRule(rule);
      return helpdesk.createRule(rule);
    },
    update(actor, id, fields) {
      requireAdmin(actor);
      const merged = { ...find(id), ...fields };
      validateRule(merged);
      return helpdesk.updateRule(id, fields);
    },
    remove(actor, id) {
      requireAdmin(actor);
      find(id);
      helpdesk.deleteRule(id);
    },
  };
}
