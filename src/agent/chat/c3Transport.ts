import type {
  Author,
  ChatEvent,
  ChatTransport,
  Message as C3Message,
  OutgoingMessage,
} from '@c3theme/chat/core';

import { http, query, type Realtime, upload } from '../api';
import type { Message } from '../types';
import { toC3Message, type ChatMappingContext } from './c3Mapping';

interface Options extends ChatMappingContext {
  displayId: number;
  realtime: Realtime;
}

/**
 * Implementa a porta `ChatTransport` do `@c3theme/chat` sobre a API atual do app: histórico paginado por `before`,
 * envio por JSON (texto) ou multipart (arquivos) e eventos do SSE (`message.created/updated`, `typing_on/off`).
 * Nenhum componente do pacote conhece essas rotas — é aqui que a integração vive.
 */
export function createChatTransport({ displayId, realtime, ...context }: Options): ChatTransport {
  const path = `/conversations/${displayId}`;
  const conversationId = String(displayId);

  async function loadMessages(
    _conversationId: string,
    page: { before?: string; limit: number },
    _signal?: AbortSignal,
  ) {
    const before = page.before ? Number(page.before) : undefined;
    const list = await http<Message[]>(`${path}/messages${query({ before })}`);
    return {
      messages: list.map((message) => toC3Message(message, context)),
      hasMore: list.length >= page.limit,
    };
  }

  async function send(outgoing: OutgoingMessage): Promise<C3Message> {
    if (outgoing.files?.length) {
      const form = new FormData();
      form.append('content', outgoing.text ?? '');
      form.append('private', 'false');
      if (outgoing.replyTo) form.append('in_reply_to', outgoing.replyTo);
      for (const file of outgoing.files) form.append('attachments[]', file);
      const saved = await upload<Message | Message[]>(`${path}/messages`, form);
      const first = Array.isArray(saved) ? saved[0] : saved;
      return { ...toC3Message(first, context), clientId: outgoing.clientId };
    }
    const saved = await http<Message>(`${path}/messages`, 'POST', {
      content: outgoing.text ?? '',
      private: false,
      ...(outgoing.replyTo ? { in_reply_to: Number(outgoing.replyTo) } : {}),
    });
    return { ...toC3Message(saved, context), clientId: outgoing.clientId };
  }

  function subscribe(_conversationId: string, onEvent: (event: ChatEvent) => void) {
    return realtime.subscribe(({ event, data }) => {
      if (data.display_id !== displayId) return;
      if (event === 'message.created' || event === 'message.updated') {
        const message = toC3Message(data as unknown as Message, context);
        onEvent(
          data.deleted ? { type: 'removed', conversationId, id: message.id } : { type: 'message', message },
        );
        return;
      }
      if (event === 'message.deleted') {
        onEvent({ type: 'removed', conversationId, id: String(data.id) });
        return;
      }
      if (event === 'conversation.typing_on' || event === 'conversation.typing_off') {
        const author = (data.user ?? {}) as { id?: number; name?: string | null };
        if (author.id === Number(context.me.id)) return;
        const typingAuthor: Author = {
          id: String(author.id ?? 'contact'),
          name: author.name || context.contactName,
        };
        onEvent({
          type: 'typing',
          conversationId,
          author: typingAuthor,
          typing: event === 'conversation.typing_on',
        });
      }
    });
  }

  return { loadMessages, send, subscribe };
}
