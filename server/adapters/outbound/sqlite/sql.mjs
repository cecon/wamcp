export const iso = (ms = Date.now()) => new Date(ms).toISOString();
export const PAGE = 25;
export const placeholders = (values) => values.map(() => '?').join(',') || 'NULL';

/** UPDATE limited to whitelisted columns; booleans are stored as 0/1. */
export function updateFields(db, table, id, fields, allowed) {
  const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(
    ...keys.map((k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k])),
    id,
  );
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
