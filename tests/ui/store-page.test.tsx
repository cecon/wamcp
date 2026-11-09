import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { Catalog } from '../../src/agent/types';
import type { Store, TemplatePreview } from '../../src/agent/settings/store/types';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const card = { category: 'Contabilidade', icon: 'calculator', version: '1.0.0' };
const plugin = {
  ...card,
  id: 'contador',
  name: 'Contador',
  description: 'Documentos e prazos',
  url: 'https://loja.example/contador/plugin.json',
  docs: 'https://loja.example/contador',
  installed: null,
};
const template = {
  ...card,
  id: 'contador',
  name: 'Contador',
  description: 'Atende os clientes do escritório',
  plugin: 'contador',
  agent_name: 'Assistente do escritório',
  role: 'operator',
  runtime: 'opencode',
  model: null,
  instructions: 'Atenda.',
  goals: ['Nenhum documento atrasado'],
  tools: [{ tool: 'contador.prazos', effect: 'allow' as const }],
  schedules: ['Lembrar prazos'],
  plugin_installed: null,
};
const store = (extra: Partial<Store> = {}): Store => ({
  name: 'Loja do WAMCP',
  source: 'https://raw.example/catalog.json',
  default_source: true,
  plugins: [plugin, { ...plugin, id: 'suporte', name: 'Suporte', icon: 'unknown', docs: null }],
  agents: [template],
  ...extra,
});
const preview: TemplatePreview = {
  template,
  plugin,
  manifest: {
    id: 'contador',
    name: 'Contador',
    version: '1.0.0',
    description: '',
    skills: [],
    tools: [
      {
        name: 'prazos',
        description: 'Prazos que vencem',
        side_effects: false,
        sensitive: false,
        internal_only: false,
        endpoint: { kind: 'http', url: 'http://127.0.0.1:8790/prazos', credential: 'token' },
      },
    ],
    credentials: [{ name: 'token', help: 'O CONTADOR_TOKEN' }],
    schedules: [
      { name: 'Lembrar prazos', description: 'Dias 15 e 28', cron: '0 9 15,28 * *', prompt: 'Avise' },
    ],
  },
  credentials_set: [],
};

function renderStore() {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'store' }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
}

describe('Store', () => {
  it('installs an agent template with its credential and inbox and says what is left', async () => {
    const api = fakeApi({
      'GET /store': store(),
      'GET /store/agents/contador': preview,
      'GET /inboxes': [inbox],
      'POST /store/agents/contador': {
        agent: { id: 9, name: 'Cora' },
        plugin: { manifest: { ...preview.manifest } },
        granted: ['contador.prazos'],
        routines: ['Contador: Lembrar prazos'],
        pending: ['Libere mensagens.enviar_whatsapp em Motor de agentes'],
      },
    });
    const user = renderStore();
    const article = await screen.findByRole('article', { name: 'Contador' });
    expect(within(article).getByText('Contabilidade')).toBeInTheDocument();
    await user.click(within(article).getByRole('button', { name: 'Instalar o agente Contador' }));

    const dialog = await screen.findByRole('dialog', { name: /Instalar o agente/ });
    expect(await within(dialog).findByText('Prazos que vencem (contador.prazos)')).toBeInTheDocument();
    expect(within(dialog).getByText('Lembrar prazos (Dias 15 e 28)')).toBeInTheDocument();
    expect(within(dialog).getByText('Nenhum documento atrasado')).toBeInTheDocument();
    const name = within(dialog).getByLabelText(/Nome do agente/);
    await user.clear(name);
    await user.type(name, 'Cora');
    await user.type(within(dialog).getByLabelText('Credencial token'), 's3gredo');
    await user.selectOptions(within(dialog).getByLabelText('Caixa que ele atende'), String(inbox.id));
    await user.click(within(dialog).getByRole('button', { name: 'Instalar e criar o agente' }));

    expect(await screen.findByText('Cora está pronto')).toBeInTheDocument();
    expect(screen.getByText('Libere mensagens.enviar_whatsapp em Motor de agentes')).toBeInTheDocument();
    expect(api.called('POST', '/store/agents/contador')[0].body).toEqual({
      name: 'Cora',
      credentials: { token: 's3gredo' },
      inbox_id: inbox.id,
    });
  });

  it('installs and updates skills and changes the catalog address', async () => {
    let current = store();
    const api = fakeApi({
      'GET /store': () => current,
      'POST /store/plugins/contador': { manifest: { ...preview.manifest, version: '1.0.0' } },
      'PUT /store/source': (body) => {
        if ((body as { url: string | null }).url === 'http://example.org/c.json')
          throw status(400, 'use HTTPS');
        return { source: 'https://minha.example/catalog.json' };
      },
    });
    const user = renderStore();
    await user.click(await screen.findByRole('tab', { name: /Habilidades/ }));
    await user.click(await screen.findByRole('button', { name: 'Instalar Contador' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contador v1.0.0 instalado');

    current = store({
      plugins: [
        {
          ...plugin,
          version: '1.1.0',
          installed: { version: '1.0.0', enabled: true, update: true, credentials_missing: ['token'] },
        },
      ],
    });
    await user.click(screen.getByRole('tab', { name: /Agentes/ }));
    await user.click(screen.getByRole('tab', { name: /Habilidades/ }));
    await user.click(screen.getByRole('button', { name: 'Instalar Contador' }));
    expect(await screen.findByRole('button', { name: 'Atualizar Contador' })).toBeInTheDocument();
    expect(screen.getByText(/falta configurar: token/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Como ligar' })).toHaveAttribute(
      'href',
      'https://loja.example/contador',
    );

    await user.click(screen.getByRole('button', { name: 'Endereço da loja' }));
    const dialog = await screen.findByRole('dialog', { name: /Endereço da loja/ });
    const field = within(dialog).getByLabelText('Endereço do catalog.json');
    await user.type(field, 'http://example.org/c.json');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('use HTTPS');
    await user.clear(field);
    await user.type(field, 'https://minha.example/catalog.json');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(api.called('PUT', '/store/source').at(-1)?.body).toEqual({
      url: 'https://minha.example/catalog.json',
    });
  });

  it('shows why the catalog could not be read', async () => {
    fakeApi({
      'GET /store': () => {
        throw status(502, 'Não consegui ler a loja');
      },
    });
    renderStore();
    expect(await screen.findByText('Não consegui ler a loja')).toBeInTheDocument();
  });
});
