import { test, expect } from '@playwright/test';
import { startBackend, origin, callback } from './backend';

test.setTimeout(600_000);

test('browser consent preserves Origin and approves only the selected test session', async ({ page }) => {
  const backend = await startBackend();
  try {
    const [a, b] = [await backend.session('Session A'), await backend.session('Session B')];
    const resource = `${origin}/mcp/${a.id}`;
    const client = await backend.register();
    const flow = await backend.begin(client.client_id, resource);
    expect(flow.response.status).toBe(200);
    const link = await backend.admin(`/api/sessions/${a.id}/chatgpt/link`, { scope: 'read' });
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
      submittedOrigin = (await request.allHeaders()).origin;
      const response = await fetch(`${backend.url}/oauth/approve`, {
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
    const exchanged = await backend.form('/token', {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code: new URL(page.url()).searchParams.get('code')!,
      code_verifier: flow.verifier,
      redirect_uri: callback,
      resource,
    });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json();
    expect(tokens.scope).toBe('whatsapp:read');
    expect((await backend.rpc(tokens.access_token, a.id)).status).toBe(200);
    expect((await backend.rpc(tokens.access_token, b.id)).status).toBe(401);
    expect(await backend.admin(`/api/sessions/${a.id}/chatgpt`)).toHaveLength(1);
    expect(await backend.admin(`/api/sessions/${b.id}/chatgpt`)).toHaveLength(0);
  } finally {
    await backend.stop();
  }
});
