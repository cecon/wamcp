import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { Catalog } from '../../src/agent/types';
import type { Plugin } from '../../src/agent/settings/plugins/types';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const plugin = (id: string, name: string, extra: Partial<Plugin> = {}): Plugin => ({
  manifest: {
    id,
    name,
    version: '1.0.0',
    description: `Plugin ${name}`,
    skills: [{ name: 'Atender', description: '' }],
    tools: [
      {
        name: 'anotar_pedido',
        description: 'Anota um pedido',
        side_effects: true,
        sensitive: false,
        internal_only: false,
        endpoint: { kind: 'http', url: 'https://loja.example/pedido', credential: 'token' },
      },
    ],
    credentials: [{ name: 'token', help: 'Chave da loja' }],
  },
  enabled: true,
  builtin: false,
  installed: '',
  updated: '',
  credentials_set: [],
  ...extra,
});

function renderPlugins() {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'plugins' }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
}

describe('Plugins settings', () => {
  it('lists plugins, toggles one, fills a credential and removes it', async () => {
    const delivery = plugin('delivery', 'Delivery');
    const api = fakeApi({
      'GET /plugins': [plugin('financeiro', 'Financeiro', { builtin: true }), delivery],
      'PATCH /plugins/delivery': { ...delivery, enabled: false },
      'PUT /plugins/delivery/credentials/token': { ...delivery, credentials_set: ['token'] },
      'DELETE /plugins/delivery': {},
    });
    const user = renderPlugins();
    expect(await screen.findByText('2 plugins')).toBeInTheDocument();
    expect(screen.getAllByText('Falta configurar: token')).toHaveLength(2);
    expect(screen.getByText(/delivery\.anotar_pedido/)).toBeInTheDocument();
    // Plugins that ship with the app cannot be removed.
    expect(screen.queryByRole('button', { name: 'Excluir Financeiro' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Ativar Delivery' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/plugins/delivery')[0]?.body).toEqual({ enabled: false }),
    );

    await user.click(screen.getByRole('button', { name: 'Credenciais de Delivery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Credenciais de Delivery' });
    await user.type(within(dialog).getByLabelText(/token/), 's3gredo');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PUT', '/plugins/delivery/credentials/token')[0]?.body).toEqual({ value: 's3gredo' }),
    );

    await user.click(screen.getByRole('button', { name: 'Excluir Delivery' }));
    await user.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(api.called('DELETE', '/plugins/delivery')).toHaveLength(1));
  });

  it('installs a pasted manifest and reports invalid JSON or a refusal', async () => {
    const api = fakeApi({
      'GET /plugins': [],
      'POST /plugins': (body) => {
        if ((body as { id: string }).id === 'ruim') throw status(400, 'Manifesto inválido: falta tools');
        return plugin('delivery', 'Delivery');
      },
    });
    const user = renderPlugins();
    expect(await screen.findByText('Nenhum plugin instalado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Instalar plugin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Instalar plugin' });
    const field = within(dialog).getByLabelText('Manifesto');

    await user.type(field, 'não é json');
    await user.click(within(dialog).getByRole('button', { name: 'Instalar' }));
    expect(await within(dialog).findByText('O manifesto não é um JSON válido')).toBeInTheDocument();

    await user.clear(field);
    await user.click(field);
    await user.paste('{"id": "ruim"}');
    await user.click(within(dialog).getByRole('button', { name: 'Instalar' }));
    expect(await within(dialog).findByText('Manifesto inválido: falta tools')).toBeInTheDocument();

    await user.clear(field);
    await user.click(field);
    await user.paste('{"id": "delivery"}');
    await user.click(within(dialog).getByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.called('POST', '/plugins').map((c) => c.body)).toEqual([{ id: 'ruim' }, { id: 'delivery' }]);
  });
});
