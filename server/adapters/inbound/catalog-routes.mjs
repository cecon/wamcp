import { z } from 'zod';

const id = z.coerce.number().int().positive();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const label = z.object({
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).nullable().optional(),
  color: color.optional(),
  show_on_sidebar: z.boolean().optional(),
});
const canned = z.object({
  short_code: z.string().trim().min(1).max(40),
  content: z.string().trim().min(1).max(4096),
});

/** Labels, canned responses, notifications and the realtime stream under /api/v1. */
export function catalogRoutes(api, { catalog, notifications, realtime, accounts }) {
  api.get('/labels', (_req, res) => res.json(catalog.labels()));
  api.post('/labels', (req, res) =>
    res.status(201).json(catalog.createLabel(req.user, label.parse(req.body))),
  );
  api.patch('/labels/:id', (req, res) =>
    res.json(catalog.updateLabel(req.user, id.parse(req.params.id), label.partial().parse(req.body))),
  );
  api.delete('/labels/:id', (req, res) => {
    catalog.deleteLabel(req.user, id.parse(req.params.id));
    res.json({ ok: true });
  });

  api.get('/canned_responses', (req, res) =>
    res.json(catalog.cannedResponses(z.string().max(100).default('').parse(req.query.q))),
  );
  api.post('/canned_responses', (req, res) =>
    res.status(201).json(catalog.createCanned(req.user, canned.parse(req.body))),
  );
  api.patch('/canned_responses/:id', (req, res) =>
    res.json(catalog.updateCanned(req.user, id.parse(req.params.id), canned.partial().parse(req.body))),
  );
  api.delete('/canned_responses/:id', (req, res) => {
    catalog.deleteCanned(req.user, id.parse(req.params.id));
    res.json({ ok: true });
  });

  api.get('/notifications', (req, res) => res.json(notifications.list(req.user)));
  api.get('/notifications/unread_count', (req, res) => res.json(notifications.unreadCount(req.user)));
  api.post('/notifications/read_all', (req, res) => res.json(notifications.readAll(req.user)));
  api.patch('/notifications/:id', (req, res) =>
    res.json(notifications.read(req.user, id.parse(req.params.id))),
  );

  /** Server-Sent Events: works through the Cloudflare tunnel without WebSocket upgrades. */
  api.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const write = (envelope) =>
      res.write(
        `event: ${envelope.event}\ndata: ${JSON.stringify({ data: envelope.data, performer: envelope.performer })}\n\n`,
      );
    const unsubscribe = realtime.stream(req.user, write);
    // Keep proxies from closing idle streams, and end streams whose user lost access.
    const timer = setInterval(() => {
      if (!accounts.isActive(req.user.id)) return res.end();
      res.write(': ping\n\n');
    }, 25000);
    req.on('close', () => {
      clearInterval(timer);
      unsubscribe();
    });
  });
}
