import { iso, PAGE, updateFields } from './sql.mjs';

/** Contacts and their per-inbox WhatsApp identities (JIDs). */
export function contactStore(db) {
  const contact = (id) => db.prepare('SELECT * FROM contacts WHERE id=?').get(id) || null;
  return {
    contact,
    contactInbox: (inboxId, sourceId) =>
      db.prepare('SELECT * FROM contact_inboxes WHERE inbox_id=? AND source_id=?').get(inboxId, sourceId) ||
      null,
    contactByPhone: (phone) => db.prepare('SELECT * FROM contacts WHERE phone_number=?').get(phone) || null,
    createContact({ name, phone }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO contacts(name,phone_number,created) VALUES(?,?,?)')
        .run(name ?? null, phone ?? null, iso());
      return contact(Number(lastInsertRowid));
    },
    createContactInbox(contactId, inboxId, sourceId) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO contact_inboxes(contact_id,inbox_id,source_id) VALUES(?,?,?)')
        .run(contactId, inboxId, sourceId);
      return db.prepare('SELECT * FROM contact_inboxes WHERE id=?').get(Number(lastInsertRowid));
    },
    contacts: (q = '', page = 1) =>
      db
        .prepare(
          "SELECT * FROM contacts WHERE COALESCE(name,'') LIKE ? OR COALESCE(phone_number,'') LIKE ? OR COALESCE(email,'') LIKE ? ORDER BY last_activity_at DESC NULLS LAST, id DESC LIMIT ? OFFSET ?",
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`, PAGE, (page - 1) * PAGE),
    updateContact(id, fields) {
      updateFields(db, 'contacts', id, fields, [
        'name',
        'email',
        'phone_number',
        'identifier',
        'blocked',
        'last_activity_at',
      ]);
      return contact(id);
    },
  };
}
