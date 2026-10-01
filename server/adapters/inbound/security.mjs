import { timingSafeEqual } from 'node:crypto';
export const bearer = (req) => req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
function same(a, b) {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
export function adminSecurity(admin, adminToken) {
  admin.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        'http://127.0.0.1:1420',
        'http://localhost:1420',
        'http://tauri.localhost',
        'https://tauri.localhost',
        'tauri://localhost',
      ].includes(origin)
    )
      return res.sendStatus(403);
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (!same(bearer(req), adminToken)) return res.sendStatus(401);
    next();
  });
}
