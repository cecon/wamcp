import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { mcpService } from '../server/application/mcp.mjs';
import { mcpTools } from '../server/adapters/inbound/mcp-tools.mjs';
import { downloadMedia } from '../server/adapters/outbound/media-download.mjs';
import { MAX_MEDIA_BYTES } from '../server/domain/media.mjs';

const jid = '5511999999999@s.whatsapp.net';
const audio = (id = 'audio') => ({
  key: { id, remoteJid: jid },
  messageTimestamp: 100,
  message: {
    ephemeralMessage: {
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          seconds: 3,
          fileLength: 4,
          mediaKey: Buffer.from('private-key'),
          url: 'https://example.invalid/private-media',
        },
      },
    },
  },
});

function storage(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-media-'));
  let store = openStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openStore(dir);
    },
  };
}

async function fixture(t) {
  const { store } = storage(t);
  const session = store.createSession('Media');
  const credential = store.issueToken(session.id, 'Reader', 'read');
  const downloads = [];
  const wa = {
    media: async (...args) => {
      downloads.push(args);
      return Buffer.from('data').toString('base64');
    },
  };
  const service = mcpService(store, wa);
  const server = mcpTools(
    service,
    session.id,
    store.authenticate(session.id, credential.token),
    credential.token,
    'https://example.invalid',
  );
  const client = new Client({ name: 'media-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const get = (messageId, conversation = jid) =>
    client.callTool({ name: 'get_media', arguments: { jid: conversation, messageId } });
  return { store, session, credential, client, downloads, wa, get };
}

test('media persists across restarts without leaking download credentials into history', (t) => {
  const db = storage(t);
  const s = db.store.createSession('Persistent');
  db.store.message(s.id, audio());
  db.store.message(s.id, audio());
  db.reopen();
  const messages = db.store.messages(s.id, jid);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'audioMessage');
  assert.equal(messages[0].media.voice, true);
  assert.equal(messages[0].media.duration, 3);
  assert.equal(messages[0].media.size, 4);
  assert.doesNotMatch(JSON.stringify(messages), /private-key|private-media|mediaKey|payload/);
  assert.doesNotMatch(JSON.stringify(db.store.search(s.id, 'audio')), /private-key|private-media/);
  assert.equal(
    Buffer.from(db.store.media(s.id, jid, 'audio').message.message.audioMessage.mediaKey).toString(),
    'private-key',
  );
});

test('existing text database upgrades without losing history', (t) => {
  const db = storage(t);
  const s = db.store.createSession('Legacy');
  db.store.message(s.id, { key: { id: 'old', remoteJid: jid }, message: { conversation: 'kept' } });
  db.store.db.exec('DROP TABLE message_media');
  db.reopen();
  assert.equal(db.store.messages(s.id, jid)[0].body, 'kept');
  assert.equal(db.store.messages(s.id, jid)[0].media, null);
  db.store.message(s.id, audio());
  assert.ok(db.store.media(s.id, jid, 'audio'));
});

test('MCP returns native audio and embedded document resources for read credentials', async (t) => {
  const f = await fixture(t);
  f.store.message(f.session.id, audio());
  const result = await f.get('audio');
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content[1], {
    type: 'audio',
    data: 'ZGF0YQ==',
    mimeType: 'audio/ogg; codecs=opus',
  });
  assert.equal(f.downloads[0][0], f.session.id);
  assert.equal(f.store.events(f.session.id)[0].action, 'get_media');
  f.store.message(f.session.id, {
    key: { id: 'doc', remoteJid: jid },
    message: {
      documentWithCaptionMessage: {
        message: { documentMessage: { fileName: 'invoice.pdf', mimetype: 'application/pdf', fileLength: 4 } },
      },
    },
  });
  assert.equal(f.store.search(f.session.id, 'invoice.pdf')[0].media.type, 'document');
  const doc = await f.get('doc');
  assert.equal(doc.content[1].type, 'resource');
  assert.equal(doc.content[1].resource.mimeType, 'application/pdf');
  assert.equal(doc.content[1].resource.blob, 'ZGF0YQ==');
  assert.match(doc.content[1].resource.uri, /^wamcp:\/\/sessions\//);
  assert.ok(!(await f.client.listTools()).tools.some((tool) => tool.name === 'send_message'));
});

test('MCP refuses other sessions, conversations, missing attachments and invalid IDs', async (t) => {
  const f = await fixture(t);
  const other = f.store.createSession('Other');
  f.store.message(other.id, audio());
  assert.equal((await f.get('audio')).isError, true);
  f.store.message(f.session.id, audio());
  assert.equal((await f.get('audio', '5522999999999@s.whatsapp.net')).isError, true);
  assert.equal((await f.get('missing')).isError, true);
  assert.equal((await f.get('audio', '../../other')).isError, true);
  assert.equal(f.downloads.length, 0);
});

test('MCP rejects oversized files before download and hides internal failures', async (t) => {
  const f = await fixture(t);
  const large = audio('large');
  large.message.ephemeralMessage.message.audioMessage.fileLength = MAX_MEDIA_BYTES + 1;
  f.store.message(f.session.id, large);
  assert.match((await f.get('large')).content[0].text, /10 MiB/);
  assert.equal(f.downloads.length, 0);
  f.store.message(f.session.id, audio());
  f.wa.media = async () => {
    throw new Error('secret-url-and-key');
  };
  const error = await f.get('audio');
  assert.equal(error.isError, true);
  assert.doesNotMatch(JSON.stringify(error), /secret-url-and-key/);
});

test('revocation before or during download prevents releasing content', async (t) => {
  const f = await fixture(t);
  f.store.message(f.session.id, audio());
  f.wa.media = async () => {
    f.store.revoke(f.session.id, f.credential.id);
    return 'ZGF0YQ==';
  };
  const result = await f.get('audio');
  assert.equal(result.isError, true);
  assert.ok(result._meta['mcp/www_authenticate']);
  assert.doesNotMatch(JSON.stringify(result), /ZGF0YQ==/);
  assert.equal((await f.get('audio')).isError, true);
});

test('stream downloads enforce actual byte limit, errors and timeout', async () => {
  const normal = () => Promise.resolve(Readable.from([Buffer.from('ok')]));
  assert.equal(await downloadMedia({}, {}, normal), 'b2s=');
  const tooLarge = Readable.from([Buffer.alloc(MAX_MEDIA_BYTES), Buffer.from('!')]);
  await assert.rejects(
    downloadMedia({}, {}, async () => tooLarge),
    /10 MiB/,
  );
  assert.equal(tooLarge.destroyed, true);
  const stalled = new Readable({ read() {} });
  await assert.rejects(
    downloadMedia({}, {}, async () => stalled, 10),
    /demorou/,
  );
  assert.equal(stalled.destroyed, true);
  await assert.rejects(
    downloadMedia({}, {}, async () => {
      throw new Error('network');
    }),
    /network/,
  );
});
