import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { ROLES, AVAILABILITY } from '../../domain/helpdesk.mjs';
import { SESSION_COOKIE, clientKey, readCookie, requireAgent, sessionCookie } from './web-auth.mjs';

const id = z.coerce.number().int().positive();
const name = z.string().trim().min(1).max(80);
const email = z.string().trim().email().max(200);
const password = z.string().min(10).max(200);
const ids = z.object({ user_ids: z.array(id).min(1).max(200) });

/** Auth, profile, agents, teams and inboxes under /api/v1 (public listener, via tunnel). */
export function accountRoutes(api, accounts) {
  api.post(
    '/auth/login',
    rateLimit({
      windowMs: 900000,
      limit: 10,
      keyGenerator: clientKey,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res) => {
      const body = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
      const session = await accounts.login(body.email, body.password, req.headers['user-agent']);
      res.setHeader('Set-Cookie', sessionCookie(session.cookie, session.maxAge));
      res.json({ user: accounts.me(session.user), csrf: session.csrf });
    },
  );
  api.use(requireAgent(accounts));
  api.post('/auth/logout', (req, res) => {
    const cookie = readCookie(req, SESSION_COOKIE);
    if (cookie) accounts.logout(cookie);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });
  api.get('/auth/me', (req, res) => res.json({ user: accounts.me(req.user), csrf: req.csrf || null }));
  api.patch('/profile', async (req, res) => {
    const body = z
      .object({
        name: name.optional(),
        display_name: z.string().trim().max(80).nullable().optional(),
        availability: z.enum(AVAILABILITY).optional(),
        current_password: z.string().max(200).optional(),
        password: password.optional(),
      })
      .parse(req.body);
    res.json(await accounts.updateProfile(req.user, body));
  });
  api.post('/profile/access_token', (req, res) => res.status(201).json(accounts.issueApiToken(req.user)));

  api.get('/agents', (_req, res) => res.json(accounts.agents()));
  api.post('/agents', async (req, res) => {
    const body = z
      .object({
        name,
        email,
        role: z.enum(ROLES).default('agent'),
        password,
        inbox_ids: z.array(id).max(100).default([]),
      })
      .parse(req.body);
    res.status(201).json(await accounts.createAgent(req.user, body));
  });
  api.patch('/agents/:id', async (req, res) => {
    const body = z
      .object({
        name: name.optional(),
        display_name: z.string().trim().max(80).nullable().optional(),
        role: z.enum(ROLES).optional(),
        active: z.boolean().optional(),
        password: password.optional(),
      })
      .parse(req.body);
    res.json(await accounts.updateAgent(req.user, id.parse(req.params.id), body));
  });
  api.delete('/agents/:id', (req, res) => {
    accounts.deleteAgent(req.user, id.parse(req.params.id));
    res.json({ ok: true });
  });

  const team = z.object({
    name,
    description: z.string().trim().max(500).nullable().optional(),
    allow_auto_assign: z.boolean().optional(),
  });
  api.get('/teams', (_req, res) => res.json(accounts.teams()));
  api.post('/teams', (req, res) => res.status(201).json(accounts.createTeam(req.user, team.parse(req.body))));
  api.patch('/teams/:id', (req, res) =>
    res.json(accounts.updateTeam(req.user, id.parse(req.params.id), team.partial().parse(req.body))),
  );
  api.delete('/teams/:id', (req, res) => {
    accounts.deleteTeam(req.user, id.parse(req.params.id));
    res.json({ ok: true });
  });
  api.get('/teams/:id/members', (req, res) => res.json(accounts.teamMembers(id.parse(req.params.id))));
  api.post('/teams/:id/members', (req, res) =>
    res.json(
      accounts.changeTeamMembers(req.user, id.parse(req.params.id), ids.parse(req.body).user_ids, true),
    ),
  );
  api.delete('/teams/:id/members', (req, res) =>
    res.json(
      accounts.changeTeamMembers(req.user, id.parse(req.params.id), ids.parse(req.body).user_ids, false),
    ),
  );

  api.get('/inboxes', (req, res) => res.json(accounts.inboxes(req.user)));
  api.get('/inboxes/:id', (req, res) => res.json(accounts.inbox(req.user, id.parse(req.params.id))));
  api.patch('/inboxes/:id', (req, res) => {
    const body = z
      .object({
        name: name.optional(),
        enable_auto_assignment: z.boolean().optional(),
        greeting_enabled: z.boolean().optional(),
        greeting_message: z.string().max(1000).nullable().optional(),
        lock_to_single_conversation: z.boolean().optional(),
        ignore_groups: z.boolean().optional(),
        timezone: z.string().max(64).optional(),
      })
      .parse(req.body);
    res.json(accounts.updateInbox(req.user, id.parse(req.params.id), body));
  });
  api.get('/inboxes/:id/members', (req, res) =>
    res.json(accounts.inboxMembers(req.user, id.parse(req.params.id))),
  );
  api.post('/inboxes/:id/members', (req, res) =>
    res.json(
      accounts.changeInboxMembers(req.user, id.parse(req.params.id), ids.parse(req.body).user_ids, true),
    ),
  );
  api.delete('/inboxes/:id/members', (req, res) =>
    res.json(
      accounts.changeInboxMembers(req.user, id.parse(req.params.id), ids.parse(req.body).user_ids, false),
    ),
  );
}

/** Desktop-only (admin token) endpoints to create the first administrator. */
export function bootstrapRoutes(admin, accounts) {
  admin.get('/api/helpdesk/status', (_req, res) => res.json({ needsBootstrap: accounts.needsBootstrap() }));
  admin.post('/api/helpdesk/bootstrap', async (req, res) => {
    const body = z.object({ name, email, password }).parse(req.body);
    res.status(201).json(await accounts.bootstrap(body));
  });
}
