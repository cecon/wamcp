import { normalizeMessageContent } from '@whiskeysockets/baileys';

/** Turns a Baileys WebMessageInfo into the flat shape stored locally; returns null for unusable events. */
export function describeWaMessage(m) {
  if (!m?.key?.id || !m.key.remoteJid || !m.message) return null;
  const jid = m.key.remoteJid;
  if (jid === 'status@broadcast') return null;
  const content = normalizeMessageContent(m.message) || {};
  const kind = Object.keys(content).find((k) => k !== 'messageContextInfo') || 'unknown';
  const body =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.documentMessage?.fileName ||
    `[${kind.replace('Message', '')}]`;
  return {
    id: m.key.id,
    jid,
    // WhatsApp is moving chats to @lid addresses; the alternate JID carries the phone number when known.
    altJid: m.key.remoteJidAlt || null,
    fromMe: Boolean(m.key.fromMe),
    sender: m.pushName || m.key.participant || jid,
    pushName: m.key.fromMe ? null : m.pushName || null,
    body,
    kind,
    ts: Number(m.messageTimestamp || Date.now() / 1000),
  };
}

/** Maps Baileys proto WebMessageInfo.Status numbers to helpdesk delivery states. */
export function receiptStatus(status) {
  if (status === 0) return 'failed';
  if (status === 3) return 'delivered';
  if (status === 4 || status === 5) return 'read';
  return null;
}
