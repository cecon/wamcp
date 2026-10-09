import { test, expect } from '@playwright/test';
import { mockApi, nativeMock, openSettings } from './app-mock';

test('automatically prepares the update and waits for restart before installation', async ({ page }) => {
  await nativeMock(page);
  await mockApi(page);
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Conversas' })).toBeVisible();
  await page.clock.fastForward(11000);
  await expect(page.getByText('WA MCP 26.10.99 disponível')).toBeVisible();
  expect(await page.locator('html').getAttribute('data-update-installed')).toBeNull();
  await page.getByRole('button', { name: 'Reiniciar e atualizar' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-update-installed', 'yes');
  await expect(page.getByRole('button', { name: 'Instalando…' })).toBeDisabled();
});

test('toggling Windows autostart calls the native command and reflects its state', async ({ page }) => {
  await nativeMock(page);
  await mockApi(page);
  await page.goto('/');
  await openSettings(page, 'Aplicativo');
  const toggle = page.getByRole('switch', { name: 'Iniciar com o Windows' });
  await expect(toggle).not.toBeChecked();
  await page.getByText('Iniciar com o Windows', { exact: true }).click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await openSettings(page, 'Aplicativo');
  await expect(page.getByRole('switch', { name: 'Iniciar com o Windows' })).toBeChecked();
  await expect(page.getByLabel('Endereço na rede local')).toHaveValue('http://192.168.0.10:17382/app/');
});

test('failed signature never offers installation and preserves the application', async ({ page }) => {
  await nativeMock(page, true);
  await mockApi(page);
  await page.goto('/');
  await openSettings(page, 'Aplicativo');
  await page.getByRole('button', { name: 'Verificar atualizações' }).click();
  await expect(page.getByText(/Falha ao validar assinatura/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reiniciar e atualizar' })).not.toBeVisible();
});

test('browsers on the network never see the desktop page', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conexões WhatsApp', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aplicativo', exact: true })).toHaveCount(0);
});
