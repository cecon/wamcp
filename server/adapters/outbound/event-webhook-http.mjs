import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { callbackUrl, resolveCallback, WebhookError } from './event-webhook-address.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;

function verifyIdentity(hostname, certificate) {
  if (!isIP(hostname)) return checkServerIdentity(hostname, certificate);
  // Use the certificate's IP SAN, avoiding DNS/IDNA normalization of IPv6 literals.
  // TLS still validates the complete chain through rejectUnauthorized below.
  try {
    if (new X509Certificate(certificate.raw).checkIP(hostname)) return undefined;
  } catch {}
  return new WebhookError('delivery_failed');
}

export function postWebhook(destination, body, headers, { resolve, request, timeoutMs }) {
  const { url, hostname } = callbackUrl(destination);
  return new Promise((accept, reject) => {
    let done = false;
    let req;
    let response;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      response?.destroy();
      req?.destroy();
      if (error) reject(error);
      else accept(result);
    };
    // A wall-clock deadline covers DNS, connect, TLS, headers and the full response.
    const timer = setTimeout(() => finish(new WebhookError('timeout')), timeoutMs);
    const send = async () => {
      const { address, family } = await resolveCallback(hostname, resolve);
      if (done) return;
      req = request(
        {
          protocol: 'https:',
          hostname: address,
          family,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          // Connect directly to the validated IP; no second DNS lookup or pooled socket.
          agent: false,
          servername: isIP(hostname) ? '' : hostname,
          rejectUnauthorized: true,
          checkServerIdentity: (_host, certificate) => verifyIdentity(hostname, certificate),
          maxHeaderSize: 16384,
          headers: { ...headers, Host: url.host, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          response = res;
          res.on('error', () => finish(new WebhookError('delivery_failed')));
          res.on('aborted', () => finish(new WebhookError('delivery_failed')));
          if (done) return res.destroy();
          const status = res.statusCode;
          if (!Number.isInteger(status) || status < 100 || status > 599) {
            return finish(new WebhookError('delivery_failed'));
          }
          // Node's native request never follows redirects. Do not consume error bodies.
          if (status < 200 || status >= 300) return finish(null, { status, body: '' });
          if (Number(res.headers['content-length']) > MAX_RESPONSE_BYTES) {
            return finish(new WebhookError('delivery_failed'));
          }
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            if (done) return;
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) return finish(new WebhookError('delivery_failed'));
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (res.complete === false) return finish(new WebhookError('delivery_failed'));
            finish(null, { status, body: Buffer.concat(chunks).toString('utf8') });
          });
          res.on('close', () => {
            if (!done) finish(new WebhookError('delivery_failed'));
          });
        },
      );
      req.on('error', () => finish(new WebhookError('delivery_failed')));
      req.maxHeadersCount = 100;
      req.end(body);
    };
    send().catch((error) =>
      finish(error instanceof WebhookError ? error : new WebhookError('delivery_failed')),
    );
  });
}
