import { transaction } from './sql.mjs';
import { inboxStore } from './inbox-store.mjs';
import { contactStore } from './contact-store.mjs';
import { conversationStore } from './conversation-store.mjs';
import { messageStore } from './message-store.mjs';
import { catalogStore } from './catalog-store.mjs';

/** Helpdesk repository: one port object composed from the per-aggregate SQLite stores. */
export function helpdeskStore(db) {
  return {
    transaction: (work) => transaction(db, work),
    ...inboxStore(db),
    ...contactStore(db),
    ...conversationStore(db),
    ...messageStore(db),
    ...catalogStore(db),
  };
}
