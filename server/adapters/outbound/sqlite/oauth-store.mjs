import { createHash, randomBytes } from 'node:crypto';
export function oauthStore(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS oauth_items(bucket TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(bucket,key));`,
  );
  return {
    hash: (value) => createHash('sha256').update(value).digest('hex'),
    secret: () => randomBytes(32).toString('base64url'),
    now: () => Date.now(),
    get(bucket, key) {
      const row = db
        .prepare('SELECT value FROM oauth_items WHERE bucket=? AND key=? AND expires>?')
        .get(bucket, key, Date.now());
      return row ? JSON.parse(row.value) : null;
    },
    set(bucket, key, value, expires = Number.MAX_SAFE_INTEGER) {
      db.prepare(
        'INSERT INTO oauth_items VALUES(?,?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value,expires=excluded.expires',
      ).run(bucket, key, JSON.stringify(value), expires);
    },
    remove(bucket, key) {
      db.prepare('DELETE FROM oauth_items WHERE bucket=? AND key=?').run(bucket, key);
    },
    list(bucket) {
      return db
        .prepare('SELECT value FROM oauth_items WHERE bucket=? AND expires>?')
        .all(bucket, Date.now())
        .map((row) => JSON.parse(row.value));
    },
    prune() {
      db.prepare('DELETE FROM oauth_items WHERE expires<=?').run(Date.now());
    },
    transaction(operation) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
