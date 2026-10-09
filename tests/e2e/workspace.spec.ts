import { test, expect } from '@playwright/test';
import { mockApi, openSettings } from './app-mock';

test('connection creation, MCP token display and revocation', async ({ page }) => {
  const session = { id: 'test-session', name: 'Atendimento', status: 'disconnected', phone: null };
  let created = false,
    revoked = false,
    issued = false;
  const token = { id: 'token-1', name: 'My AI', scope: 'read', expires: '2027-01-01' };
  await mockApi(page, {
    'GET /sessions': () => (created ? [session] : []),
    'POST /sessions': () => {
      created = true;
      return session;
    },
    'GET /sessions/test-session': () => ({
      ...session,
      qr: null,
      mcpUrl: 'https://wamcp.cappyfy.com/mcp/test-session',
    }),
    'GET /sessions/test-session/chatgpt': () => [],
    'POST /sessions/test-session/chatgpt/link': (body) => {
      expect((body as { scope: string }).scope).toBe('read');
      return { code: 'one-time-link-code', expires: '2026-10-01T23:59:00Z' };
    },
    'GET /sessions/test-session/tokens': () => (issued && !revoked ? [token] : []),
    'POST /sessions/test-session/tokens': () => {
      issued = true;
      return { ...token, token: 'wamcp_test-only' };
    },
    'DELETE /sessions/test-session/tokens/token-1': () => {
      revoked = true;
      return { ok: true };
    },
  });
  await page.goto('/');
  await openSettings(page, 'Conexões WhatsApp');
  await expect(page.getByRole('heading', { name: 'Conexões WhatsApp' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova conexão' }).click();
  await page.getByLabel('Nome da conexão').fill('Atendimento');
  await page.getByRole('button', { name: 'Criar conexão' }).click();
  await expect(page.getByRole('heading', { name: 'Atendimento', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'ChatGPT' }).click();
  await page.getByRole('button', { name: 'Gerar código para o ChatGPT' }).click();
  await expect(page.getByLabel('Código para o ChatGPT')).toHaveValue('one-time-link-code');
  await page.getByRole('button', { name: 'Ocultar código' }).click();
  await expect(page.getByLabel('Código para o ChatGPT')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Acesso MCP' }).click();
  await page.getByLabel('Nome da integração').fill('My AI');
  await page.getByRole('button', { name: 'Gerar token' }).click();
  await expect(page.getByText('Copie agora. Este token só aparece uma vez.')).toBeVisible();
  await expect(page.getByLabel('Token de acesso')).toHaveValue('wamcp_test-only');
  await page.screenshot({ path: 'test-results/connection-mcp.png', fullPage: true });
  await page.getByRole('button', { name: 'Já copiei, ocultar token' }).click();
  await expect(page.getByText('Copie agora. Este token só aparece uma vez.')).not.toBeVisible();
  await page.getByRole('button', { name: 'Revogar My AI' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revogar' }).click();
  await expect(page.getByRole('button', { name: 'Revogar My AI' })).not.toBeVisible();
  expect(revoked).toBe(true);
});
