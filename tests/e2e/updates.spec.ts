import { test, expect, type Page } from '@playwright/test';
async function nativeMock(page: Page, fail = false) {
  await page.addInitScript((failure) => {
    let updateListener: ((event: { payload: string }) => void) | undefined;
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: { payload: string }) => void) {
          updateListener = callback;
          return 1;
        },
        async invoke(command: string, args?: { enabled?: boolean }) {
          if (command === 'api_request') return [];
          if (command === 'runtime_status') return { tunnelConfigured: true, tunnelRunning: true };
          if (command === 'autostart_status') return localStorage.getItem('autostart') === 'yes';
          if (command === 'set_autostart') {
            localStorage.setItem('autostart', args?.enabled ? 'yes' : 'no');
            return null;
          }
          if (command === 'check_update') {
            updateListener?.({ payload: '26.10.99' });
            if (failure) throw new Error('Falha ao validar assinatura. A versão atual foi mantida.');
            return { version: '26.10.99' };
          }
          if (command === 'install_update') document.documentElement.dataset.updateInstalled = 'yes';
          return 1;
        },
      },
    });
  }, fail);
}
test('automatically prepares the update and waits for restart before installation', async ({ page }) => {
  await nativeMock(page);
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Minhas sessões' })).toBeVisible();
  await page.clock.fastForward(11000);
  await expect(page.getByText('WA MCP 26.10.99 disponível')).toBeVisible();
  expect(await page.locator('html').getAttribute('data-update-installed')).toBeNull();
  await page.getByRole('button', { name: 'Reiniciar e atualizar' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-update-installed', 'yes');
  await expect(page.getByRole('button', { name: 'Instalando…' })).toBeDisabled();
});
test('toggling Windows autostart calls the native command and reflects its state', async ({ page }) => {
  await nativeMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: 'Iniciar automaticamente com o Windows' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.reload();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Iniciar automaticamente com o Windows' })).toBeChecked();
});
test('failed signature never offers installation and preserves the application', async ({ page }) => {
  await nativeMock(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Verificar atualizações' }).click();
  await expect(page.getByText(/Falha ao validar assinatura/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reiniciar e atualizar' })).not.toBeVisible();
  await page.getByRole('button', { name: /Minhas sessões/ }).click();
  await expect(page.getByRole('heading', { name: 'Minhas sessões' })).toBeVisible();
});
