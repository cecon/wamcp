import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { CustomRole, RosterAgent, RuntimeStatus } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const PROFILES: CustomRole[] = [
  { id: 21, name: 'Operador', description: null, permissions: [], agent_role: 'operator', builtin: false },
];
const RUNTIMES: RuntimeStatus[] = [
  { id: 'claude_cli', available: false, detail: 'Não instalado neste computador' },
  { id: 'codex_cli', available: false, detail: 'Não instalado neste computador' },
  { id: 'opencode', available: true, detail: 'C:/npm/opencode.exe' },
];
const roster = (id: number, fields: Partial<RosterAgent>): RosterAgent => ({
  id,
  name: `Agente ${id}`,
  kind: 'ai',
  role: 'operator',
  profile_id: 21,
  profile_name: 'Operador',
  description: null,
  user_id: null,
  user_name: null,
  user_email: null,
  whatsapp_jid: null,
  runtime: 'claude_cli',
  model: 'haiku',
  instructions: null,
  active: true,
  skill_ids: [],
  credential_count: 0,
  ...fields,
});

function renderSettings(section: SettingsSection, id?: number, cat = catalog) {
  const onChange = vi.fn(async () => {});
  render(
    <SettingsRouter
      route={{ page: 'settings', section, id }}
      user={admin}
      catalog={cat}
      onNavigate={vi.fn()}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('AI agent runtimes', () => {
  it('marks runtimes missing on this computer and starts new agents on an installed one', async () => {
    const api = fakeApi({
      'GET /agent_directory': [],
      'GET /custom_roles': PROFILES,
      'GET /skills': [],
      'GET /agent_runtimes': RUNTIMES,
      'POST /agent_directory': (body) => roster(5, body as Partial<RosterAgent>),
    });
    const { user } = renderSettings('agents');
    await user.click(await screen.findByRole('button', { name: 'Adicionar agente de IA' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar agente de IA' });
    const runtime = within(dialog).getByLabelText('Runtime');
    await waitFor(() => expect(runtime).toHaveValue('opencode'));
    expect(within(dialog).getByText(/Encontrado em C:\/npm\/opencode\.exe/)).toBeInTheDocument();
    expect(within(dialog).getByText(/credencial de API deste agente/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /OpenClaude/ })).not.toBeInTheDocument();
    const codex = within(dialog).getByRole('option', { name: /Codex CLI.*não instalado/ });
    expect(codex).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Nome'), 'Rota');
    await user.type(
      within(dialog).getByLabelText('Modelo (provedor/modelo)'),
      'openrouter/openai/gpt-4o-mini',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Criar agente' }));
    await waitFor(() => expect(api.called('POST', '/agent_directory')).toHaveLength(1));
    expect(api.called('POST', '/agent_directory')[0].body).toMatchObject({
      runtime: 'opencode',
      model: 'openrouter/openai/gpt-4o-mini',
    });
  });

  it('keeps an existing agent on its runtime and says how to install it', async () => {
    fakeApi({
      'GET /agent_directory': [roster(4, { name: 'Ana' })],
      'GET /custom_roles': PROFILES,
      'GET /skills': [],
      'GET /agent_runtimes': RUNTIMES,
      'GET /agent_directory/4/credentials': [],
    });
    const { user } = renderSettings('agents');
    await user.click(await screen.findByRole('button', { name: 'Editar Ana' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar Ana' });
    expect(await within(dialog).findByText(/Instale o Claude Code/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Runtime')).toHaveValue('claude_cli');
  });
});

describe('inbox AI agent', () => {
  it('connects an executing AI agent to the inbox', async () => {
    const api = fakeApi({
      'GET /inboxes/10/members': [admin],
      'GET /inboxes/10/working_hours': [],
      'GET /agent_directory': [
        roster(1, { name: 'Ana' }),
        roster(2, { name: 'Chefe', role: 'coordinator' }),
        roster(3, { name: 'Bia', kind: 'human', runtime: null }),
        roster(4, { name: 'Parada', active: false }),
      ],
      'POST /inboxes/10/ai_agent': { ...inbox, ai_agent_id: 1 },
    });
    const { user, onChange } = renderSettings('inboxes', 10);
    const select = screen.getByLabelText('Agente de IA');
    await screen.findByRole('option', { name: /Ana/ });
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Nenhum', 'Ana · Claude Code · haiku']);
    await user.selectOptions(select, '1');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.called('POST', '/inboxes/10/ai_agent')[0].body).toEqual({ ai_agent_id: 1 });
  });
});
