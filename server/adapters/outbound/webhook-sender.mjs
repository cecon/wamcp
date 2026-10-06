import { createHmac, randomBytes } from 'node:crypto';

const TIMEOUT_MS = 10000;

/**
 * Delivers webhook payloads like Chatwoot: JSON body signed with HMAC-SHA256 of
 * "<timestamp>.<body>" in X-Wamcp-Signature, so receivers can verify origin and reject replays.
 */
export const webhookSender = {
  secret: () => randomBytes(24).toString('base64url'),
  async post(url, body, secret, fetchImpl = fetch) {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'wamcp-webhooks',
        'X-Wamcp-Event': body.event,
        'X-Wamcp-Timestamp': timestamp,
        'X-Wamcp-Signature': `sha256=${signature}`,
      },
      body: raw,
    });
    return { status: response.status, ok: response.status >= 200 && response.status < 300 };
  },
};
