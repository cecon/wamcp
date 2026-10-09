import type { Page } from '@playwright/test';

const admin = {
  id: 1,
  email: 'admin@example.com',
  name: 'Admin',
  display_name: null,
  role: 'administrator',
  availability: 'online',
  active: 1,
  inbox_ids: [],
};

/** Answers the API of a signed-in administrator; `routes` overrides "METHOD /path" (without /api/v1). */
export async function mockApi(page: Page, routes: Record<string, (body: unknown) => unknown> = {}) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const key = `${request.method()} ${path}`;
    if (path === '/events') return route.fulfill({ status: 204, body: '' });
    let data: unknown = [];
    if (key in routes) data = routes[key](request.postDataJSON());
    else if (path === '/auth/me') data = { user: admin, csrf: 'csrf' };
    else if (path === '/notifications/unread_count') data = { unread: 0 };
    else if (path === '/conversations/meta') data = { mine: 0, unassigned: 0, all: 0 };
    else if (path === '/api/helpdesk/status') data = { needsBootstrap: false, local: true };
    await route.fulfill({ json: data });
  });
}

/** The Tauri bridge of the desktop window (native commands and the update event). */
export async function nativeMock(page: Page, fail = false) {
  await page.addInitScript((failure) => {
    let updateListener: ((event: { payload: string }) => void) | undefined;
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: { payload: string }) => void) {
          updateListener = callback;
          return 1;
        },
        async invoke(command: string, args?: { enabled?: boolean }) {
          if (command === 'runtime_status')
            return {
              tunnelConfigured: true,
              tunnelRunning: true,
              dataDir: 'C:\\dados',
              networkUrl: 'http://192.168.0.10:17382/app/',
            };
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

/** Sidebar → Configurações → the given settings page. */
export async function openSettings(page: Page, label: string) {
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
}
