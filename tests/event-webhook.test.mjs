import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eventWebhook, webhookSignature } from '../server/adapters/outbound/event-webhook.mjs';
import { fixture, reply, subscription, event } from './event-webhook-fixture.mjs';

test('Standard Webhooks official JavaScript signing test vector', () => {
  // https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/webhook.test.ts
  assert.equal(
    webhookSignature(
      'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      'msg_p5jXN8AQM9LWM0D4loKWxJek',
      '1614265330',
      '{"test": 2432232314}',
    ),
    'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
  );
});

function checkSignature(call, secret = subscription.secret) {
  const {
    settings: { headers },
    body,
  } = call;
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`)
    .digest('base64');
  assert.ok(headers['webhook-signature'].split(' ').includes(`v1,${signature}`));
  return signature;
}

test('verification uses fresh signed challenges and unique IDs without application data', async () => {
  const { webhook, calls } = fixture();
  assert.equal(await webhook.verify(subscription), undefined);
  await webhook.verify(subscription);
  const bodies = calls.map((call) => JSON.parse(call.body));
  for (const [index, body] of bodies.entries()) {
    assert.deepEqual(Object.keys(body), ['type', 'challenge']);
    assert.equal(body.type, 'verification');
    assert.equal(Buffer.from(body.challenge, 'base64url').length, 32);
    assert.equal(calls[index].settings.headers['X-MCP-Subscription-Id'], subscription.id);
    checkSignature(calls[index]);
  }
  assert.notEqual(bodies[0].challenge, bodies[1].challenge);
  assert.notEqual(calls[0].settings.headers['webhook-id'], calls[1].settings.headers['webhook-id']);
});

test('verification rejects mismatched, malformed, missing and non-string challenge echoes', async () => {
  for (const body of [
    '{}',
    '{',
    'null',
    '{"challenge":1}',
    '{"challenge":"wrong"}',
    '{"challenge":"' + 'x'.repeat(43) + '"}',
  ]) {
    const { webhook } = fixture({ respond: (_call, callback) => reply(callback, 200, body) });
    await assert.rejects(webhook.verify(subscription), {
      reason: 'challenge_failed',
      message: 'Webhook request failed.',
    });
  }
});

test('a challenge from a previous request is never reusable', async () => {
  let previous;
  const { webhook } = fixture({
    respond: ({ body }, callback) => {
      const { challenge } = JSON.parse(body);
      reply(callback, 200, JSON.stringify({ challenge: previous ?? challenge }));
      previous = challenge;
    },
  });
  await webhook.verify(subscription);
  await assert.rejects(webhook.verify(subscription), { reason: 'challenge_failed' });
});

test('non-2xx verification fails even if a challenge is echoed', async () => {
  for (const status of [301, 302, 307, 308, 400, 500]) {
    const { webhook, calls } = fixture({
      respond: ({ body }, callback) => reply(callback, status, body, { location: 'https://127.0.0.1/' }),
    });
    await assert.rejects(webhook.verify(subscription), { reason: 'challenge_failed' });
    assert.equal(calls.length, 1);
  }
});

test('delivery serializes once and signs exact UTF-8 bytes with matching event ID', async () => {
  let serializations = 0;
  const { webhook, calls } = fixture();
  const payload = {
    eventId: 'unused',
    toJSON() {
      serializations++;
      return event;
    },
  };
  assert.deepEqual(await webhook.deliver(subscription, payload), { status: 200, accepted: true });
  assert.equal(serializations, 1);
  assert.equal(calls[0].body, JSON.stringify(event));
  assert.equal(calls[0].settings.headers['webhook-id'], event.eventId);
  assert.equal(calls[0].settings.headers['Content-Length'], Buffer.byteLength(calls[0].body));
  assert.equal(calls[0].settings.headers['Content-Type'], 'application/json');
  checkSignature(calls[0]);
});

test('retries preserve event ID and body but regenerate signing time and signature', async () => {
  let time = 1700000000000;
  const { webhook, calls } = fixture({ now: () => time });
  await webhook.deliver(subscription, event);
  time += 3000;
  await webhook.deliver(subscription, event);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].settings.headers['webhook-id'], calls[1].settings.headers['webhook-id']);
  assert.notEqual(
    calls[0].settings.headers['webhook-timestamp'],
    calls[1].settings.headers['webhook-timestamp'],
  );
  assert.notEqual(checkSignature(calls[0]), checkSignature(calls[1]));
});

test('rotation signs with both secrets only until the epoch-millisecond deadline', async () => {
  let time = 1700000000000;
  const rotated = {
    ...subscription,
    previousSecret: `whsec_${Buffer.alloc(24, 9).toString('base64')}`,
    rotateUntil: time + 1000,
  };
  const { webhook, calls } = fixture({ now: () => time });
  await webhook.deliver(rotated, event);
  assert.equal(calls[0].settings.headers['webhook-signature'].split(' ').length, 2);
  checkSignature(calls[0]);
  checkSignature(calls[0], rotated.previousSecret);
  time = rotated.rotateUntil;
  await webhook.deliver(rotated, event);
  assert.equal(calls[1].settings.headers['webhook-signature'].split(' ').length, 1);
});

test('delivery returns HTTP status without following redirects or retrying', async () => {
  for (const status of [200, 204, 299, 302, 307, 410, 413, 429, 503]) {
    const { webhook, calls } = fixture({
      respond: (_call, callback) => reply(callback, status, '', { location: 'https://10.0.0.1/' }),
    });
    assert.deepEqual(await webhook.deliver(subscription, event), { status, accepted: status < 300 });
    assert.equal(calls.length, 1);
  }
});

test('payload limit is measured in UTF-8 bytes and accepts exactly 256 KiB', async () => {
  const { webhook, calls } = fixture();
  const payload = { eventId: 'evt_limit', text: '' };
  const remaining = 262144 - Buffer.byteLength(JSON.stringify(payload));
  payload.text = 'x'.repeat(remaining);
  await webhook.deliver(subscription, payload);
  assert.equal(Buffer.byteLength(calls[0].body), 262144);
  payload.text += 'x';
  await assert.rejects(webhook.deliver(subscription, payload), { reason: 'payload_too_large' });
  payload.text = 'é'.repeat(140000);
  await assert.rejects(webhook.deliver(subscription, payload), { reason: 'payload_too_large' });
  assert.equal(calls.length, 1);
});

test('invalid secrets, event IDs and unserializable bodies never create a request', async () => {
  const { webhook, calls } = fixture();
  for (const secret of [
    'raw',
    'whsec_',
    'whsec_!!!!',
    `whsec_${Buffer.alloc(23).toString('base64')}`,
    `whsec_${Buffer.alloc(65).toString('base64')}`,
  ]) {
    await assert.rejects(webhook.deliver({ ...subscription, secret }, event), { reason: 'invalid_secret' });
  }
  for (const eventId of ['', undefined, 'invalid.id', 'x\r\ny', 'x'.repeat(257)]) {
    await assert.rejects(webhook.deliver(subscription, { ...event, eventId }), { reason: 'invalid_event' });
  }
  for (const body of [undefined, null, { data: 1n }]) {
    await assert.rejects(webhook.deliver(subscription, body), { reason: 'invalid_event' });
  }
  assert.equal(calls.length, 0);
});

test('request and DNS errors never expose addresses, URL tokens or secrets', async () => {
  const detail = 'private detail: 10.0.0.1 secret callback?token=sensitive';
  const webhook = eventWebhook({
    request: () => {
      throw new Error(detail);
    },
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  await assert.rejects(webhook.deliver(subscription, event), {
    reason: 'delivery_failed',
    message: 'Webhook request failed.',
  });
  await assert.rejects(webhook.verify(subscription), {
    reason: 'challenge_failed',
    message: 'Webhook request failed.',
  });
  const failedDns = fixture({
    resolve: async () => {
      throw new Error(detail);
    },
  }).webhook;
  await assert.rejects(failedDns.verify(subscription), {
    reason: 'invalid_url',
    message: 'Webhook request failed.',
  });
});
