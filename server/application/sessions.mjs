import { requireSession } from '../domain/access.mjs';
/** Use cases depend on repository and WhatsApp ports, never on their implementations. */
export function sessionService(repository, whatsapp, events) {
  const exists = (id) => requireSession(repository.session(id));
  return {
    sessions: () => repository.sessions(),
    session: (id) => repository.session(id),
    createSession: (name) => repository.createSession(name),
    detail: (id) => {
      exists(id);
      return whatsapp.detail(id);
    },
    connect: (id) => {
      exists(id);
      return whatsapp.connect(id);
    },
    stop: (id, logout) => {
      exists(id);
      events?.disconnect(id);
      return whatsapp.stop(id, logout);
    },
    chats: (id, q) => {
      exists(id);
      return repository.chats(id, q);
    },
    messages: (id, jid, before, limit, beforeId) => {
      exists(id);
      return repository.messages(id, jid, before, limit, beforeId);
    },
    search: (id, q, limit) => {
      exists(id);
      return repository.search(id, q, limit);
    },
    tokens: (id) => {
      exists(id);
      return repository.tokens(id);
    },
    issueToken: (id, name, scope, days) => {
      exists(id);
      return repository.issueToken(id, name, scope, days);
    },
    revoke: (id, tokenId) => {
      exists(id);
      return repository.revoke(id, tokenId);
    },
    events: (id) => {
      exists(id);
      return repository.events(id);
    },
  };
}
