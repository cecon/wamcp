import type { Attachment as C3Attachment, Author, Message as C3Message } from '@c3theme/chat/core';

import type { Attachment, Message } from '../types';

/** Contexto necessário para traduzir as mensagens do app para o contrato do `@c3theme/chat`. */
export interface ChatMappingContext {
  me: Author;
  contactName: string;
}

/** Anexo do app -> anexo do contrato (url já vem pronta em `data_url`). */
export function toC3Attachment(attachment: Attachment): C3Attachment {
  return {
    id: String(attachment.id),
    name: attachment.file_name || 'Anexo',
    size: attachment.file_size ?? 0,
    contentType: attachment.mime_type || '',
    url: attachment.data_url,
    durationMs: attachment.duration ? attachment.duration * 1000 : undefined,
  };
}

/**
 * Mensagem do app (Chatwoot: tipos `incoming/outgoing/activity`, status `pending/sent/…`, anexos com `data_url`)
 * -> mensagem do contrato do C3 Chat (`direction`, `kind`, `attachments`, `replyTo`, `meta`).
 */
export function toC3Message(message: Message, context: ChatMappingContext): C3Message {
  const out = message.message_type === 'outgoing' || message.message_type === 'template';
  const status =
    message.status === 'pending'
      ? 'sending'
      : message.status === 'sent' ||
          message.status === 'delivered' ||
          message.status === 'read' ||
          message.status === 'failed'
        ? message.status
        : undefined;
  return {
    id: String(message.id),
    conversationId: String(message.conversation_id),
    author: {
      id: out ? context.me.id : 'contact',
      name: message.sender_name || (out ? context.me.name : context.contactName),
    },
    direction: out ? 'out' : 'in',
    kind: message.message_type === 'activity' ? 'system' : 'text',
    text: message.content ?? undefined,
    attachments: message.attachments?.map(toC3Attachment),
    createdAt: new Date(message.created_at * 1000).toISOString(),
    status: out ? status : undefined,
    replyTo:
      message.content_attributes?.in_reply_to !== null &&
      message.content_attributes?.in_reply_to !== undefined
        ? String(message.content_attributes.in_reply_to)
        : undefined,
    meta: {
      private: message.private,
      messageType: message.message_type,
      reactions: message.content_attributes?.reactions,
      edited: message.content_attributes?.edited,
      deleted: message.content_attributes?.deleted,
    },
  };
}
