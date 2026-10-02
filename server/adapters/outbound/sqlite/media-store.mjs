import { normalizeMessageContent, proto } from '@whiskeysockets/baileys';

const mediaKinds = ['audio', 'document', 'image', 'video', 'sticker'];

export function mediaStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS message_media(
    session_id TEXT NOT NULL,jid TEXT NOT NULL,id TEXT NOT NULL,
    metadata TEXT NOT NULL,payload BLOB NOT NULL,
    PRIMARY KEY(session_id,jid,id),
    FOREIGN KEY(session_id,jid,id) REFERENCES messages(session_id,jid,id) ON DELETE CASCADE
  )`);
  return {
    save(session, message) {
      const content = normalizeMessageContent(message.message);
      const type = mediaKinds.find((kind) => content?.[`${kind}Message`]);
      if (!type) return;
      const media = content[`${type}Message`];
      const metadata = {
        type,
        mimeType: media.mimetype || 'application/octet-stream',
        fileName: media.fileName || null,
        size: media.fileLength == null ? null : Number(media.fileLength),
        duration: media.seconds ?? null,
        voice: Boolean(media.ptt),
      };
      // Keep download credentials private; history only exposes the metadata above.
      const payload = proto.WebMessageInfo.encode(
        proto.WebMessageInfo.fromObject({ ...message, message: { [`${type}Message`]: media } }),
      ).finish();
      db.prepare(
        `INSERT INTO message_media VALUES(?,?,?,?,?) ON CONFLICT(session_id,jid,id)
         DO UPDATE SET metadata=excluded.metadata,payload=excluded.payload`,
      ).run(session, message.key.remoteJid, message.key.id, JSON.stringify(metadata), payload);
    },
    describe(row) {
      const media = db
        .prepare('SELECT metadata FROM message_media WHERE session_id=? AND jid=? AND id=?')
        .get(row.session_id, row.jid, row.id);
      return { ...row, media: media ? JSON.parse(media.metadata) : null };
    },
    get(session, jid, id) {
      const row = db
        .prepare('SELECT metadata,payload FROM message_media WHERE session_id=? AND jid=? AND id=?')
        .get(session, jid, id);
      return row
        ? { metadata: JSON.parse(row.metadata), message: proto.WebMessageInfo.decode(row.payload) }
        : null;
    },
  };
}
