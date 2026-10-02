import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { WebhookError } from './event-webhook-address.mjs';
import { postWebhook } from './event-webhook-http.mjs';

function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length > 94 || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) {
    throw new WebhookError('invalid_secret');
  }
  const encoded = secret.slice(6);
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64') !== encoded) {
    throw new WebhookError('invalid_secret');
  }
  return key;
}

// Standard Webhooks v1: HMAC-SHA256 over the exact id.timestamp.body bytes.
export function webhookSignature(secret, id, timestamp, body) {
  const signature = createHmac('sha256', signingKey(secret))
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest('base64');
  return `v1,${signature}`;
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    throw new WebhookError('invalid_event');
  }
  return value;
}

export function eventWebhook({
  resolve = lookup,
  request = httpsRequest,
  now = Date.now,
  timeoutMs = 10000,
} = {}) {
  // Injection is for controlled tests; callers cannot raise the production deadline.
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 10000)) : 10000;
  async function send(subscription, value, id) {
    let body;
    try {
      body = JSON.stringify(value);
    } catch {
      throw new WebhookError('invalid_event');
    }
    if (typeof body !== 'string') throw new WebhookError('invalid_event');
    if (Buffer.byteLength(body, 'utf8') > 256 * 1024) throw new WebhookError('payload_too_large');
    // Read the identifier from the serialized snapshot, even for objects with toJSON/getters.
    id ??= JSON.parse(body)?.eventId;
    const signedAt = now();
    const timestamp = String(Math.floor(signedAt / 1000));
    identifier(id);
    identifier(subscription.id);
    const signatures = [webhookSignature(subscription.secret, id, timestamp, body)];
    if (subscription.previousSecret && subscription.rotateUntil > signedAt) {
      signatures.push(webhookSignature(subscription.previousSecret, id, timestamp, body));
    }
    return postWebhook(
      subscription.url,
      body,
      {
        'Content-Type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': signatures.join(' '),
        'X-MCP-Subscription-Id': subscription.id,
      },
      { resolve, request, timeoutMs: deadline },
    );
  }
  return {
    async verify(subscription) {
      const challenge = randomBytes(32).toString('base64url');
      try {
        const result = await send(subscription, { type: 'verification', challenge }, `msg_${randomUUID()}`);
        if (result.status < 200 || result.status >= 300) throw new WebhookError('challenge_failed');
        const echo = JSON.parse(result.body)?.challenge;
        if (typeof echo !== 'string') throw new WebhookError('challenge_failed');
        const received = Buffer.from(echo, 'utf8');
        const expected = Buffer.from(challenge, 'utf8');
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
          throw new WebhookError('challenge_failed');
        }
      } catch (error) {
        const reason = ['invalid_url', 'timeout'].includes(error.reason) ? error.reason : 'challenge_failed';
        throw new WebhookError(reason);
      }
    },
    async deliver(subscription, event) {
      const response = await send(subscription, event);
      return { status: response.status, accepted: response.status >= 200 && response.status < 300 };
    },
  };
}
