import {
  isSupportJid,
  phoneFromJid,
  routeIncoming,
  routeOwnMessage,
  initialStatus,
} from '../domain/helpdesk.mjs';

const RECEIPT_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };
const TEXT_KINDS = new Set(['conversation', 'extendedTextMessage']);

/** WhatsApp → helpdesk: live messages, delivery receipts and snooze wake-ups. */
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
        const route = d.fromMe ? routeOwnMessage(conversation) : routeIncoming(conversation, inbox);
        if (route.action === 'ignore') return null;
        const hasBot = Boolean(inbox.agent_bot_enabled);
        if (route.action === 'create') {
          conversation = helpdesk.createConversation({
            inboxId: inbox.id,
            contactId: contactInbox.contact_id,
            contactInboxId: contactInbox.id,
            status: initialStatus({ hasBot }),
            ts: d.ts,
          });
          events.push(['conversation.created', conversation]);
        } else if (route.reopen) {
          conversation = helpdesk.updateConversation(conversation.id, {
            status: initialStatus({ hasBot }),
            snoozed_until: null,
          });
          events.push(['conversation.status_changed', conversation]);
        }
        const message = helpdesk.insertMessage({
          conversationId: conversation.id,
          inboxId: inbox.id,
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
        conversation = helpdesk.updateConversation(conversation.id, {
          last_activity_at: Math.max(conversation.last_activity_at, d.ts),
          ...(d.fromMe ? {} : { waiting_since: conversation.waiting_since ?? d.ts }),
        });
        events.push(['message.created', message]);
        if (!d.fromMe) core.autoAssign(conversation, events);
        return message;
      });
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
