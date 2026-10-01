import { requireSendPermission } from '../domain/access.mjs';
export function mcpService(repository, whatsapp) {
  return {
    authenticate: (id, credential) => repository.authenticate(id, credential),
    session: (id) => repository.session(id),
    chats: (id, q) => repository.chats(id, q),
    messages: (id, jid, before, limit) => repository.messages(id, jid, before, limit),
    search: (id, q, limit) => repository.search(id, q, limit),
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
