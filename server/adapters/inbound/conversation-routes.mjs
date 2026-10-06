import { z } from 'zod';
import { STATUSES } from '../../domain/helpdesk.mjs';

const id = z.coerce.number().int().positive();
const page = z.coerce.number().int().min(1).max(10000).default(1);
const listFilters = z.object({
  status: z.enum([...STATUSES, 'all']).default('open'),
  assignee_type: z.enum(['me', 'unassigned', 'assigned', 'all']).default('all'),
  inbox_id: id.optional(),
  team_id: id.optional(),
  label: z.string().trim().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  page,
});
const filters = (query) => {
  const f = listFilters.parse(query);
  return {
    status: f.status,
    assigneeType: f.assignee_type,
    inboxId: f.inbox_id,
    teamId: f.team_id,
    label: f.label,
    q: f.q,
    page: f.page,
  };
};

/** Conversations, messages and contacts under /api/v1 (requires an authenticated agent). */
export function conversationRoutes(api, helpdesk) {
  api.get('/conversations', (req, res) => res.json(helpdesk.conversations(req.user, filters(req.query))));
  api.get('/conversations/meta', (req, res) => res.json(helpdesk.meta(req.user, filters(req.query))));
  api.get('/conversations/:displayId', (req, res) =>
    res.json(helpdesk.conversation(req.user, id.parse(req.params.displayId))),
  );
  api.get('/conversations/:displayId/messages', (req, res) => {
    const q = z
      .object({ before: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(req.query);
    res.json(helpdesk.messages(req.user, id.parse(req.params.displayId), q.before, q.limit));
  });
  api.post('/conversations/:displayId/messages', async (req, res) => {
    const body = z
      .object({ content: z.string().trim().min(1).max(4096), private: z.boolean().default(false) })
      .parse(req.body);
    res.status(201).json(await helpdesk.reply(req.user, id.parse(req.params.displayId), body));
  });
  api.get('/conversations/:displayId/history', (req, res) => {
    const q = z
      .object({
        before: z.coerce.number().positive().optional(),
        before_id: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    res.json(helpdesk.history(req.user, id.parse(req.params.displayId), q.before, q.before_id, q.limit));
  });
  api.post('/conversations/:displayId/toggle_status', (req, res) => {
    const body = z
      .object({ status: z.enum(STATUSES), snoozed_until: z.number().int().positive().nullable().optional() })
      .parse(req.body);
    res.json(helpdesk.toggleStatus(req.user, id.parse(req.params.displayId), body));
  });
  api.post('/conversations/:displayId/assignments', (req, res) => {
    const body = z
      .object({ assignee_id: id.nullable().optional(), team_id: id.nullable().optional() })
      .refine((b) => b.assignee_id !== undefined || b.team_id !== undefined)
      .parse(req.body);
    res.json(helpdesk.assign(req.user, id.parse(req.params.displayId), body));
  });
  api.post('/conversations/:displayId/toggle_priority', (req, res) => {
    const { priority } = z
      .object({ priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable() })
      .parse(req.body);
    res.json(helpdesk.setPriority(req.user, id.parse(req.params.displayId), priority));
  });
  api.post('/conversations/:displayId/labels', (req, res) => {
    const { labels } = z.object({ labels: z.array(z.string().max(40)).max(50) }).parse(req.body);
    res.json(helpdesk.setLabels(req.user, id.parse(req.params.displayId), labels));
  });
  api.post('/conversations/:displayId/update_last_seen', (req, res) =>
    res.json(helpdesk.markSeen(req.user, id.parse(req.params.displayId))),
  );

  api.get('/contacts', (req, res) => {
    const q = z.object({ q: z.string().trim().max(100).default(''), page }).parse(req.query);
    res.json(helpdesk.contacts(req.user, q.q, q.page));
  });
  api.get('/contacts/:id', (req, res) => res.json(helpdesk.contact(req.user, id.parse(req.params.id))));
  api.patch('/contacts/:id', (req, res) => {
    const body = z
      .object({
        name: z.string().trim().max(120).nullable().optional(),
        email: z.string().trim().email().max(200).nullable().optional(),
        identifier: z.string().trim().max(120).nullable().optional(),
        blocked: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(helpdesk.updateContact(req.user, id.parse(req.params.id), body));
  });
}
