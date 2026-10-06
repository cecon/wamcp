import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const derive = (password, salt) =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

/** scrypt password hashing stored as `scrypt$<salt>$<hash>` (base64url). */
export const passwordHasher = {
  async hash(password) {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
  },
  async verify(password, stored) {
    const [scheme, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const key = await derive(String(password), Buffer.from(salt, 'base64url'));
    return key.length === expected.length && timingSafeEqual(key, expected);
  },
};
