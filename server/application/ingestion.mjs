import {
  isSupportJid,
  phoneFromJid,
  routeIncoming,
  routeOwnMessage,
  initialStatus,
} from '../domain/helpdesk.mjs';
import { awaitingCsat, parseRating } from '../domain/csat.mjs';
import { systemActor } from './conversation-core.mjs';

const RECEIPT_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };
const TEXT_KINDS = new Set(['conversation', 'extendedTextMessage']);
/** Events caused by the contact (new or reopened conversations) carry this performer. */
const CONTACT = systemActor('contact', 'Contato');

/** WhatsApp → helpdesk: live messages, CSAT answers, delivery receipts and snooze wake-ups. */
export function ingestion({ helpdesk, bus, core }) {
  function contactInboxFor(inbox, d, events) {
    const existing = helpdesk.contactInbox(inbox.id, d.jid);
    if (existing) return existing;
    if (d.fromMe) return null;
    const phone = phoneFromJid(d.jid) || phoneFromJid(d.altJid);
    let contact = phone ? helpdesk.contactByPhone(phone) : null;
    if (!contact) {
      contact = helpdesk.createContact({ name: d.pushName, phone });
      events.push(['contact.created', contact]);
    }
    return helpdesk.createContactInbox(contact.id, inbox.id, d.jid);
  }
  function store(conversation, contactInbox, d, events) {
    const message = helpdesk.insertMessage({
      conversationId: conversation.id,
      inboxId: conversation.inbox_id,
      messageType: d.fromMe ? 'outgoing' : 'incoming',
      content: d.body,
      contentType: TEXT_KINDS.has(d.kind) ? 'text' : d.kind,
      senderType: d.fromMe ? 'system' : 'contact',
      senderId: d.fromMe ? null : contactInbox.contact_id,
      sourceId: d.id,
      waJid: d.jid,
      createdAt: d.ts,
    });
    const contact = helpdesk.contact(contactInbox.contact_id);
    helpdesk.updateContact(contact.id, {
      last_activity_at: d.ts,
      name: contact.name || d.pushName || undefined,
    });
    events.push(['message.created', message]);
    return message;
  }
  /** A 1–5 reply to a pending survey is recorded without reopening the resolved conversation. */
  function captureCsat(conversation, contactInbox, d, events) {
    const answer = !d.fromMe && awaitingCsat(conversation, core.now()) ? parseRating(d.body) : null;
    if (!answer) return null;
    const message = store(conversation, contactInbox, d, events);
    const csat = helpdesk.createCsat({
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      assigneeId: conversation.assignee_id,
      inboxId: conversation.inbox_id,
      ...answer,
      createdAt: core.now(),
    });
    helpdesk.updateConversation(conversation.id, { csat_requested_at: null });
    events.push(['csat.created', csat]);
    return message;
  }

  return {
    /** Live WhatsApp message (not history sync) entering the support flow. */
    ingest(sessionId, d) {
      return core.commit((events) => {
        const inbox = helpdesk.inboxForSession(sessionId);
        if (!inbox || !isSupportJid(d.jid, { ignoreGroups: Boolean(inbox.ignore_groups) })) return null;
        if (helpdesk.messageBySource(inbox.id, d.id)) return null;
        const contactInbox = contactInboxFor(inbox, d, events);
        if (!contactInbox) return null;
        let conversation = helpdesk.latestConversation(contactInbox.id);
        const csat = captureCsat(conversation, contactInbox, d, events);
        if (csat) return csat;
        const route = d.fromMe ? routeOwnMessage(conversation) : routeIncoming(conversation, inbox);
        if (route.action === 'ignore') return null;
        const status = initialStatus({ hasBot: Boolean(inbox.agent_bot_enabled) });
        if (route.action === 'create') {
          conversation = helpdesk.createConversation({
            inboxId: inbox.id,
            contactId: contactInbox.contact_id,
            contactInboxId: contactInbox.id,
            status,
            ts: d.ts,
          });
          events.push(['conversation.created', conversation]);
        } else if (route.reopen) {
          conversation = helpdesk.updateConversation(conversation.id, {
            status,
            snoozed_until: null,
            csat_requested_at: null,
          });
          events.push(['conversation.status_changed', conversation]);
        }
        const message = store(conversation, contactInbox, d, events);
        conversation = helpdesk.updateConversation(conversation.id, {
          last_activity_at: Math.max(conversation.last_activity_at, d.ts),
          ...(d.fromMe ? {} : { waiting_since: conversation.waiting_since ?? d.ts }),
        });
        if (!d.fromMe) core.autoAssign(conversation, events);
        return message;
      }, CONTACT);
    },
    receipt(sessionId, sourceId, status) {
      const inbox = helpdesk.inboxForSession(sessionId);
      const message = inbox && helpdesk.messageBySource(inbox.id, sourceId);
      if (!message || !status) return;
      if (status !== 'failed' && (RECEIPT_RANK[status] ?? 0) <= (RECEIPT_RANK[message.status] ?? 0)) return;
      bus.emit('message.updated', helpdesk.updateMessage(message.id, { status }));
    },
    /** Wakes snoozed conversations whose time has come; called periodically by the composition root. */
    wakeSnoozed() {
      for (const { id } of helpdesk.dueSnoozed(core.now()))
        core.commit((events) => {
          const updated = helpdesk.updateConversation(id, { status: 'open', snoozed_until: null });
          events.push(['conversation.status_changed', updated]);
          core.autoAssign(updated, events);
        });
    },
  };
}
