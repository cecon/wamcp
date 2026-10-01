import { test, expect } from '@playwright/test';
test('session creation, MCP token display and revocation', async ({ page }) => {
  const session = {
    id: 'test-session',
    name: 'Atendimento',
    status: 'disconnected',
    phone: null,
    message_count: 0,
  };
  let created = false,
    revoked = false,
    issued = false;
  await page.route('http://127.0.0.1:17381/**', async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method();
    let data: unknown = { ok: true };
    if (url.pathname === '/api/sessions') {
      if (method === 'POST') {
        created = true;
        data = session;
      } else data = created ? [session] : [];
    } else if (url.pathname.endsWith('/chatgpt/link')) {
      expect(route.request().postDataJSON().scope).toBe('read');
      data = { code: 'one-time-link-code', expires: '2026-10-01T23:59:00Z' };
    } else if (url.pathname.endsWith('/chatgpt')) data = [];
    else if (url.pathname.endsWith('/tokens')) {
      if (method === 'POST') {
        issued = true;
        data = {
          id: 'token-1',
          token: 'wamcp_test-only',
          name: 'My AI',
          scope: 'read',
          expires: '2027-01-01',
        };
      } else
        data =
          issued && !revoked ? [{ id: 'token-1', name: 'My AI', scope: 'read', expires: '2027-01-01' }] : [];
    } else if (method === 'DELETE') {
      revoked = true;
    } else if (url.pathname.endsWith('/audit')) data = [];
    else data = { ...session, qr: null, mcpUrl: 'https://wamcp.cappyfy.com/mcp/test-session' };
    await route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Minhas sessões' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Nova sessão', exact: true }).click();
  await page.getByLabel('Nome da sessão').fill('Atendimento');
  await page.getByRole('button', { name: 'Criar sessão' }).click();
  await expect(page.getByRole('heading', { name: 'Atendimento', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acesso MCP' }).click();
  await expect(page.getByRole('heading', { name: 'Conectar ao ChatGPT' })).toBeVisible();
  await page.getByRole('button', { name: 'Gerar código para ChatGPT' }).click();
  await expect(page.getByText('one-time-link-code', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar código' }).click();
  await expect(page.getByText('one-time-link-code', { exact: true })).not.toBeVisible();
  await page.getByPlaceholder('Nome da integração').fill('My AI');
  await page.getByRole('button', { name: 'Gerar token' }).click();
  await expect(page.getByText('Copie agora. Este token só aparece uma vez.')).toBeVisible();
  await expect(page.getByText('wamcp_test-only', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/session-mcp.png', fullPage: true });
  await page.getByRole('button', { name: 'Já copiei, ocultar token' }).click();
  await expect(page.getByText('Copie agora. Este token só aparece uma vez.')).not.toBeVisible();
  await page.getByRole('button', { name: 'Revogar My AI' }).click();
  await expect(page.getByRole('button', { name: 'Revogar My AI' })).not.toBeVisible();
  expect(revoked).toBe(true);
});
