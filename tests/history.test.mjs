import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
test('cursor pagination does not skip messages sharing the same timestamp', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-history-')),
    store = openStore(dir);
  try {
    const s = store.createSession('History'),
      jid = '5511999999999@s.whatsapp.net';
    for (let n = 0; n < 205; n++)
      store.message(s.id, {
        key: { id: String(n).padStart(4, '0'), remoteJid: jid },
        message: { conversation: `message ${n}` },
        messageTimestamp: 100,
      });
    const first = store.messages(s.id, jid, undefined, 100);
    const second = store.messages(s.id, jid, first[0].ts, 100, first[0].id);
    const third = store.messages(s.id, jid, second[0].ts, 100, second[0].id);
    assert.equal(new Set([...first, ...second, ...third].map((m) => m.id)).size, 205);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
