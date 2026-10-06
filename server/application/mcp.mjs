import { requireSendPermission } from '../domain/access.mjs';
import { checkMediaSize, MediaError } from '../domain/media.mjs';
export function mcpService(repository, whatsapp, oauth, helpdesk) {
  return {
    /** Helpdesk use cases executed as this session's inbox bot (absent when the helpdesk is off). */
    helpdesk,
    bot: (id) => helpdesk.botFor(id),
    authenticate: (id, credential) =>
      repository.authenticate(id, credential) || oauth?.authenticate(id, credential),
    session: (id) => repository.session(id),
    chats: (id, q) => repository.chats(id, q),
    messages: (id, jid, before, limit, beforeId) => repository.messages(id, jid, before, limit, beforeId),
    search: (id, q, limit) => repository.search(id, q, limit),
    async media(id, token, jid, messageId) {
      if (token.session_id !== id) throw new Error('Sessão não autorizada');
      const media = repository.media(id, jid, messageId);
      if (!media)
        throw new MediaError(
          'Anexo indisponível no histórico local. Consulte uma mensagem sincronizada após a atualização.',
        );
      checkMediaSize(media.metadata.size);
      repository.audit(id, token.id, 'get_media');
      const data = await whatsapp.media(id, media.message);
      return { ...media.metadata, data };
    },
    read(id, token, action, operation) {
      if (token.session_id !== id) throw new Error('Sessão não autorizada');
      repository.audit(id, token.id, action);
      return operation();
    },
    /** Write operation on the helpdesk: needs send permission on this session and is audited. */
    async act(id, token, action, operation) {
      requireSendPermission(token, id);
      const result = await operation();
      repository.audit(id, token.id, action);
      return result;
    },
    async send(id, token, jid, text) {
      requireSendPermission(token, id);
      const result = await whatsapp.send(id, jid, text);
      repository.audit(id, token.id, 'send_message');
      return result;
    },
  };
}
