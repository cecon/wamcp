import { isOpen } from '../domain/schedule.mjs';
import { CSAT_SURVEY, CSAT_THANKS } from '../domain/csat.mjs';
import { systemActor } from './conversation-core.mjs';

/**
 * Inbox-level automatic messages: greeting on new conversations, out-of-office outside working
 * hours (on new or contact-reopened conversations), the CSAT survey on resolution and its thank-you.
 */
export function autoReplyService({
  helpdesk,
  conversations,
  bus,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const send = (kind, name, conversation, content) =>
    conversations.reply(systemActor(kind, name), conversation.display_id, { content }).catch(() => null);

  async function onEvent({ event, data, performer }) {
    if (
      event === 'conversation.created' ||
      (event === 'conversation.status_changed' && performer?.type === 'contact')
    ) {
      if (data.status !== 'open' && data.status !== 'pending') return;
      const inbox = helpdesk.inbox(data.inbox_id);
      if (event === 'conversation.created' && inbox.greeting_enabled && inbox.greeting_message)
        await send('greeting', 'Saudação', data, inbox.greeting_message);
      if (inbox.out_of_office_message && !isOpen(inbox, helpdesk.workingHours(inbox.id), now()))
        await send('out_of_office', 'Fora do horário', data, inbox.out_of_office_message);
    } else if (event === 'conversation.status_changed' && data.status === 'resolved') {
      const inbox = helpdesk.inbox(data.inbox_id);
      if (!inbox.csat_survey_enabled || data.csat_requested_at) return;
      helpdesk.updateConversation(data.id, { csat_requested_at: now() });
      await send('csat', 'Pesquisa de satisfação', data, CSAT_SURVEY);
    } else if (event === 'csat.created') {
      const conversation = helpdesk.conversationById(data.conversation_id);
      if (conversation) await send('csat', 'Pesquisa de satisfação', conversation, CSAT_THANKS);
    }
  }
  return {
    listen() {
      let queue = Promise.resolve();
      return bus.subscribe((envelope) => {
        queue = queue.then(() => onEvent(envelope)).catch(() => {});
      });
    },
  };
}
