import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../../domain/webhooks.mjs';
import { ACTIONS, AUTOMATION_EVENTS, CONDITION_ATTRIBUTES, OPERATORS } from '../../domain/automation.mjs';

const id = z.coerce.number().int().positive();
const webhook = z.object({
  url: z.string().trim().max(2000),
  subscriptions: z.array(z.enum(Object.keys(WEBHOOK_EVENTS))).min(1),
  inbox_id: id.nullable().optional(),
  active: z.boolean().optional(),
});
const scalar = z.union([z.string().max(4096), z.number()]);
const rule = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  event_name: z.enum(AUTOMATION_EVENTS),
  conditions: z
    .array(
      z.object({
        attribute_key: z.enum(CONDITION_ATTRIBUTES),
        filter_operator: z.enum(OPERATORS),
        values: z.array(scalar).max(20).default([]),
        query_operator: z.enum(['and', 'or']).default('and'),
      }),
    )
    .max(20),
  actions: z
    .array(z.object({ action_name: z.enum(ACTIONS), action_params: z.array(scalar).max(20).default([]) }))
    .min(1)
    .max(20),
  active: z.boolean().optional(),
});
const period = z.object({
  since: z.coerce.number().int().positive().optional(),
  until: z.coerce.number().int().positive().optional(),
  inbox_id: id.optional(),
});

/** Webhooks, automation rules, reports and CSAT under /api/v1 (administrators only). */
export function automationRoutes(api, { webhooks, automations, reports }) {
  api.get('/webhooks', (req, res) => res.json(webhooks.list(req.user)));
  api.post('/webhooks', (req, res) =>
    res.status(201).json(webhooks.create(req.user, webhook.parse(req.body))),
  );
  api.patch('/webhooks/:id', (req, res) =>
    res.json(webhooks.update(req.user, id.parse(req.params.id), webhook.partial().parse(req.body))),
  );
  api.delete('/webhooks/:id', (req, res) => {
    webhooks.remove(req.user, id.parse(req.params.id));
    res.json({ ok: true });
  });
  api.get('/webhooks/:id/deliveries', (req, res) =>
    res.json(webhooks.deliveries(req.user, id.parse(req.params.id))),
  );

  api.get('/automation_rules', (req, res) => res.json(automations.list(req.user)));
  api.post('/automation_rules', (req, res) =>
    res.status(201).json(automations.create(req.user, rule.parse(req.body))),
  );
  api.patch('/automation_rules/:id', (req, res) =>
    res.json(automations.update(req.user, id.parse(req.params.id), rule.partial().parse(req.body))),
  );
  api.delete('/automation_rules/:id', (req, res) => {
    automations.remove(req.user, id.parse(req.params.id));
    res.json({ ok: true });
  });

  api.get('/reports/summary', (req, res) => res.json(reports.summary(req.user, period.parse(req.query))));
  api.get('/reports/agents', (req, res) => res.json(reports.agents(req.user, period.parse(req.query))));
  api.get('/csat_responses', (req, res) => res.json(reports.csat(req.user, period.parse(req.query))));
}
