import { requireSendPermission } from '../domain/access.mjs';
import { checkMediaSize, MediaError } from '../domain/media.mjs';
export function mcpService(repository, whatsapp, oauth) {
  return {
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
    async send(id, token, jid, text) {
      requireSendPermission(token, id);
      const result = await whatsapp.send(id, jid, text);
      repository.audit(id, token.id, 'send_message');
      return result;
    },
  };
}
