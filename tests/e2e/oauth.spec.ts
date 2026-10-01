import { test, expect } from '@playwright/test';
import { oauthFixture, origin, callback } from '../oauth-fixture.mjs';

test('browser consent preserves Origin and approves only the selected test session', async ({ page }) => {
  const cleanup: Array<() => Promise<void>> = [];
  const f = await oauthFixture({ after: (fn: () => Promise<void>) => cleanup.push(fn) });
  try {
    const client = await f.register();
    const flow = await f.begin(client);
    const link = f.oauth.createLink(f.a.id, 'read');
    let submittedOrigin: string | undefined;
    let approvalStatus: number | undefined;
    const policyErrors: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('form-action')) policyErrors.push(message.text());
    });
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname === '/test-consent') {
        await route.fulfill({
          status: 200,
          body: flow.html,
          headers: {
            'content-type': 'text/html',
            'content-security-policy': flow.response.headers.get('content-security-policy')!,
            'referrer-policy': flow.response.headers.get('referrer-policy')!,
          },
        });
        return;
      }
      const headers = await request.allHeaders();
      submittedOrigin = headers.origin;
      const response = await fetch(`${f.url}/oauth/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(submittedOrigin ? { origin: submittedOrigin } : {}),
        },
        body: request.postData(),
        redirect: 'manual',
      });
      approvalStatus = response.status;
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({ body: 'Test callback' }));
    await page.goto(`${origin}/test-consent`);
    await page.getByLabel('Código temporário do aplicativo').fill(link.code);
    await page.getByRole('button', { name: 'Autorizar conexão' }).click();
    expect(submittedOrigin).toBe(origin);
    expect(approvalStatus).toBe(303);
    await expect(page).toHaveURL(/https:\/\/chatgpt.com\/connector\/oauth\/test-client\?code=/);
    expect(policyErrors).toEqual([]);
    const exchanged = await f.request('/token', {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code: new URL(page.url()).searchParams.get('code'),
      code_verifier: flow.verifier,
      redirect_uri: callback,
      resource: f.resource,
    });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json();
    expect(tokens.scope).toBe('whatsapp:read');
    expect((await f.rpc(tokens.access_token)).status).toBe(200);
    expect((await f.rpc(tokens.access_token, 'get_profile', f.b)).status).toBe(401);
    expect(f.oauth.connections(f.a.id)).toHaveLength(1);
    expect(f.oauth.connections(f.b.id)).toHaveLength(0);
  } finally {
    for (const close of cleanup) await close();
  }
});
