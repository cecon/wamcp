import { z } from 'zod';
import { jidSchema } from './schemas.mjs';
export function adminRoutes(admin, sessions, publicUrl) {
  admin.get('/api/status', (_req, res) =>
    res.json({ publicUrl, service: 'ready', sessions: sessions.sessions().length }),
  );
  admin.get('/api/sessions', (_req, res) => res.json(sessions.sessions()));
  admin.post('/api/sessions', (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    res.status(201).json(sessions.createSession(name));
  });
  admin.use('/api/sessions/:id', (req, res, next) => {
    if (!sessions.session(req.params.id)) return res.status(404).json({ error: 'Sessão não encontrada' });
    next();
  });
  admin.get('/api/sessions/:id', (req, res) =>
    res.json({
      ...sessions.session(req.params.id),
      ...sessions.detail(req.params.id),
      mcpUrl: `${publicUrl}/mcp/${req.params.id}`,
    }),
  );
  admin.post('/api/sessions/:id/connect', async (req, res) => {
    await sessions.connect(req.params.id);
    res.json({ ok: true });
  });
  admin.post('/api/sessions/:id/disconnect', async (req, res) => {
    await sessions.stop(req.params.id);
    res.json({ ok: true });
  });
  admin.post('/api/sessions/:id/logout', async (req, res) => {
    await sessions.stop(req.params.id, true);
    res.json({ ok: true });
  });
  admin.get('/api/sessions/:id/chats', (req, res) =>
    res.json(sessions.chats(req.params.id, String(req.query.q || ''))),
  );
  admin.get('/api/sessions/:id/messages', (req, res) => {
    const { jid, before, limit, beforeId } = z
      .object({
        jid: jidSchema,
        before: z.coerce.number().positive().optional(),
        beforeId: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(req.query);
    res.json(sessions.messages(req.params.id, jid, before, limit, beforeId));
  });
  admin.get('/api/sessions/:id/search', (req, res) =>
    res.json(sessions.search(req.params.id, z.string().min(1).max(200).parse(req.query.q))),
  );
  admin.get('/api/sessions/:id/tokens', (req, res) => res.json(sessions.tokens(req.params.id)));
  admin.post('/api/sessions/:id/tokens', (req, res) => {
    const { name, scope, days } = z
      .object({
        name: z.string().trim().min(1).max(80),
        scope: z.enum(['read', 'read_write']),
        days: z.number().int().min(1).max(365).default(90),
      })
      .parse(req.body);
    res.status(201).json(sessions.issueToken(req.params.id, name, scope, days));
  });
  admin.delete('/api/sessions/:id/tokens/:tokenId', (req, res) => {
    sessions.revoke(req.params.id, req.params.tokenId);
    res.json({ ok: true });
  });
  admin.get('/api/sessions/:id/audit', (req, res) => res.json(sessions.events(req.params.id)));
}
