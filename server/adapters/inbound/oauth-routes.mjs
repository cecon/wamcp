import express from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAUTH_ERRORS } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { OAuthFailure, oauthScopes } from '../../domain/oauth.mjs';
import { consentPage } from './oauth-consent.mjs';
const mapped =
  (operation) =>
  (...args) => {
    try {
      return operation(...args);
    } catch (error) {
      if (error instanceof OAuthFailure) throw new OAUTH_ERRORS[error.code](error.message);
      throw error;
    }
  };
export function oauthRoutes(admin, app, oauth, publicUrl) {
  const issuer = new URL(publicUrl);
  admin.post('/api/sessions/:id/chatgpt/link', (req, res) => {
    const { scope } = z.object({ scope: z.enum(['read', 'read_write']) }).parse(req.body);
    res.json(oauth.createLink(req.params.id, scope));
  });
  admin.get('/api/sessions/:id/chatgpt', (req, res) => res.json(oauth.connections(req.params.id)));
  admin.delete('/api/sessions/:id/chatgpt/:grant', (req, res) => {
    oauth.disconnect(req.params.id, req.params.grant);
    res.json({ ok: true });
  });
  app.get('/.well-known/oauth-protected-resource/mcp/:id', (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(404);
    res.set('Access-Control-Allow-Origin', '*').json({
      resource: `${publicUrl}/mcp/${req.params.id}`,
      authorization_servers: [issuer.href],
      scopes_supported: oauthScopes,
      resource_name: 'WA MCP',
    });
  });
  const provider = {
    clientsStore: { getClient: oauth.getClient, registerClient: mapped(oauth.registerClient) },
    authorize: mapped((client, params, res) => consentPage(res, oauth.begin(client, params))),
    challengeForAuthorizationCode: mapped(oauth.challenge),
    exchangeAuthorizationCode: mapped((client, code, _verifier, redirect, resource) =>
      oauth.exchange(client, code, redirect, resource),
    ),
    exchangeRefreshToken: mapped(oauth.refresh),
    revokeToken: mapped((client, request) => oauth.revoke(client, request.token)),
  };
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      scopesSupported: oauthScopes,
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    }),
  );
  app.post(
    '/oauth/approve',
    rateLimit({ windowMs: 600000, limit: 30 }),
    express.urlencoded({ extended: false, limit: '4kb' }),
    (req, res) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      if (req.headers.origin !== issuer.origin)
        return res.status(403).send('Origem inválida. Reabra a conexão pelo ChatGPT.');
      const body = z
        .object({
          request: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .safeParse(req.body);
      if (!body.success)
        return res.status(400).send('Código inválido. Volte à página anterior e tente novamente.');
      try {
        res.redirect(303, oauth.approve(body.data.request, body.data.code));
      } catch (error) {
        if (!(error instanceof OAuthFailure)) throw error;
        res
          .status(400)
          .send('Código inválido, expirado ou de outra sessão. Volte e gere um novo código no aplicativo.');
      }
    },
  );
}
