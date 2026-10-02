import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { publicAddress } from '../server/adapters/outbound/event-webhook-address.mjs';
import { fixture, reply, subscription, event, publicRecords } from './event-webhook-fixture.mjs';
import { certificate } from './event-webhook-certificate.mjs';

const denied = [
  '0.0.0.0',
  '0.9.8.7',
  '10.1.2.3',
  '100.64.0.1',
  '100.127.255.254',
  '127.0.0.1',
  '168.63.129.16',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.254',
  '192.0.0.1',
  '192.0.2.1',
  '192.88.99.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.19.255.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '239.255.255.255',
  '240.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:169.254.169.254',
  '::ffff:8.8.8.8',
  '::127.0.0.1',
  '64:ff9b::7f00:1',
  '64:ff9b:1::a00:1',
  '100::1',
  '2001::1',
  '2001:2::1',
  '2001:10::1',
  '2001:db8::1',
  '2002:7f00:1::',
  '3fff::1',
  '5f00::1',
  'fc00::1',
  'fdff::1',
  'fe80::1',
  'ff02::1',
  'fe80::1%lo',
  '2001:4860::1%lo',
];

test('address classification rejects private, local, reserved, mapped and transition IPs', () => {
  for (const address of denied) assert.equal(publicAddress(address), false, address);
  for (const address of [
    '8.8.8.8',
    '93.184.216.34',
    '100.63.255.254',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ]) {
    assert.equal(publicAddress(address), true, address);
  }
});

test('every non-public DNS answer is blocked in both verification and delivery', async () => {
  for (const address of denied) {
    const { webhook, calls } = fixture({ resolve: async () => [{ address, family: isIP(address) }] });
    await assert.rejects(webhook.verify(subscription), { reason: 'invalid_url' }, address);
    await assert.rejects(webhook.deliver(subscription, event), { reason: 'invalid_url' }, address);
    assert.equal(calls.length, 0);
  }
});

test('rejects mixed public/private DNS records, invalid families, empty or excessive answers', async () => {
  for (const records of [
    [...publicRecords, { address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 6 }],
    [{ address: 'not-an-ip', family: 4 }],
    [],
    undefined,
    Array(65).fill(publicRecords[0]),
  ]) {
    const { webhook, calls } = fixture({ resolve: async () => records });
    await assert.rejects(webhook.deliver(subscription, event), { reason: 'invalid_url' });
    assert.equal(calls.length, 0);
  }
});

test('HTTPS-only URL validation rejects credentials, fragments and disguised local literals', async () => {
  const urls = [
    'http://8.8.8.8/',
    'file:///etc/passwd',
    'ftp://receiver.example.com/',
    'https://user:password@receiver.example.com/',
    'https://receiver.example.com/#fragment',
    'https://127.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0177.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[fe80::1%25lo]/',
    '',
    null,
    'not a url',
    'https://receiver.example.com/' + 'a'.repeat(8192),
  ];
  for (const url of urls) {
    const { webhook, calls } = fixture();
    await assert.rejects(webhook.deliver({ ...subscription, url }, event), { reason: 'invalid_url' });
    assert.equal(calls.length, 0);
  }
});

test('validated destination is pinned while TLS verification and Host use the original hostname', async () => {
  const { webhook, calls, resolutions } = fixture();
  await webhook.deliver(subscription, event);
  assert.deepEqual(resolutions, [['receiver.example.com', { all: true }]]);
  const { settings } = calls[0];
  assert.equal(settings.hostname, publicRecords[0].address);
  assert.equal(settings.family, 4);
  assert.equal(settings.agent, false);
  assert.equal(settings.servername, 'receiver.example.com');
  assert.equal(settings.headers.Host, 'receiver.example.com:8443');
  assert.equal(settings.path, '/callback?key=opaque');
  assert.equal(settings.port, '8443');
  assert.equal(settings.rejectUnauthorized, true);
  assert.equal(settings.maxHeaderSize, 16384);
  assert.equal(calls[0].req.maxHeadersCount, 100);
  assert.equal(
    settings.checkServerIdentity('ignored', { subjectaltname: 'DNS:receiver.example.com' }),
    undefined,
  );
  assert.ok(settings.checkServerIdentity('receiver.example.com', { subjectaltname: 'DNS:attacker.example' }));
});

test('public IPv4/IPv6 literals skip DNS and verify the original IP certificate identity', async () => {
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) {
    const hostname = isIP(address) === 6 ? `[${address}]` : address;
    const { webhook, calls, resolutions } = fixture();
    await webhook.deliver({ ...subscription, url: `https://${hostname}/` }, event);
    assert.equal(resolutions.length, 0);
    const { settings } = calls[0];
    assert.equal(settings.hostname, address);
    assert.equal(settings.servername, '');
    assert.equal(settings.headers.Host, hostname);
    assert.equal(settings.checkServerIdentity('ignored', { raw: Buffer.from(certificate) }), undefined);
    assert.ok(settings.checkServerIdentity('ignored', { subjectaltname: 'DNS:receiver.example.com' }));
  }
});

test('IPv6 DNS answers connect to the validated IPv6 address with original SNI', async () => {
  const { webhook, calls } = fixture({
    resolve: async () => [{ address: '2001:4860:4860::8888', family: 6 }],
  });
  await webhook.deliver(subscription, event);
  assert.equal(calls[0].settings.hostname, '2001:4860:4860::8888');
  assert.equal(calls[0].settings.family, 6);
  assert.equal(calls[0].settings.servername, 'receiver.example.com');
});

test('DNS is revalidated on every attempt; rebinding after verification cannot deliver', async () => {
  let records = publicRecords;
  const { webhook, calls, resolutions } = fixture({ resolve: async () => records });
  await webhook.verify(subscription);
  records = [{ address: '127.0.0.1', family: 4 }];
  await assert.rejects(webhook.deliver(subscription, event), { reason: 'invalid_url' });
  assert.equal(resolutions.length, 2);
  assert.equal(calls.length, 1);
});

test('DNS timeout cannot initiate a late request after resolution eventually completes', async () => {
  const deferred = Promise.withResolvers();
  const { webhook, calls } = fixture({ timeoutMs: 10, resolve: () => deferred.promise });
  await assert.rejects(webhook.verify(subscription), { reason: 'timeout' });
  deferred.resolve(publicRecords);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test('one deadline bounds stalled connect/headers and destroys the outstanding request', async () => {
  const { webhook, calls } = fixture({ timeoutMs: 10, respond: () => {} });
  await assert.rejects(webhook.deliver(subscription, event), { reason: 'timeout' });
  assert.equal(calls[0].req.destroyed, true);
});

test('one deadline also bounds a response that never finishes', async () => {
  let response;
  const { webhook, calls } = fixture({
    timeoutMs: 10,
    respond: (_call, callback) => {
      response = new Readable({ read() {} });
      response.statusCode = 200;
      response.headers = {};
      callback(response);
      response.push(Buffer.from('{"challenge":"'));
    },
  });
  await assert.rejects(webhook.verify(subscription), { reason: 'timeout' });
  assert.equal(response.destroyed, true);
  assert.equal(calls[0].req.destroyed, true);
});

test('response size is bounded by declared and actual bytes, including chunked responses', async () => {
  for (const headers of [{ 'content-length': '65537' }, {}]) {
    let response;
    const { webhook, calls } = fixture({
      respond: (_call, callback) => {
        response = reply(callback, 200, 'x'.repeat(65537), headers);
      },
    });
    await assert.rejects(webhook.deliver(subscription, event), { reason: 'delivery_failed' });
    assert.equal(response.destroyed, true);
    assert.equal(calls[0].req.destroyed, true);
  }
  const { webhook } = fixture({ respond: (_call, callback) => reply(callback, 200, 'x'.repeat(65536)) });
  assert.deepEqual(await webhook.deliver(subscription, event), { accepted: true, status: 200 });
});

test('network errors and aborted or truncated responses fail safely', async () => {
  for (const failure of ['request', 'response', 'abort', 'truncated']) {
    const { webhook } = fixture({
      respond: ({ req }, callback) => {
        if (failure === 'request') return req.emit('error', new Error('sensitive detail'));
        const response = new Readable({ read() {} });
        response.statusCode = 200;
        response.headers = {};
        callback(response);
        if (failure === 'response') response.emit('error', new Error('private body'));
        else if (failure === 'abort') response.emit('aborted');
        else {
          response.complete = false;
          response.push(null);
        }
      },
    });
    await assert.rejects(webhook.deliver(subscription, event), {
      reason: 'delivery_failed',
      message: 'Webhook request failed.',
    });
  }
});
