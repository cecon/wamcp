import { BlockList, isIP } from 'node:net';

const denied = new BlockList();
// Conservatively exclude special-purpose ranges, including translation/tunnel addresses.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['168.63.129.16', 32], // Azure platform virtual address; not a public callback destination.
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  denied.addSubnet(address, prefix, 'ipv4');

// https://www.iana.org/assignments/iana-ipv6-special-registry/
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  denied.addSubnet(address, prefix, 'ipv6');

export class WebhookError extends Error {
  constructor(reason) {
    super('Webhook request failed.');
    this.name = 'WebhookError';
    this.reason = reason;
  }
}

export function publicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !denied.check(address, 'ipv4');
  // Only native global unicast: excludes mapped IPv4, NAT64, local and multicast.
  return family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}

export function callbackUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname) && !publicAddress(hostname)) throw new Error();
    return { url, hostname };
  } catch {
    throw new WebhookError('invalid_url');
  }
}

export async function resolveCallback(hostname, resolve) {
  try {
    const family = isIP(hostname);
    const addresses = family ? [{ address: hostname, family }] : await resolve(hostname, { all: true });
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64) throw new Error();
    if (addresses.some(({ address, family }) => !publicAddress(address) || isIP(address) !== family)) {
      throw new Error();
    }
    return addresses[0];
  } catch {
    throw new WebhookError('invalid_url');
  }
}
