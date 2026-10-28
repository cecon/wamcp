import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { CustomRole, RosterAgent, Skill } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const skill = (id: number, name: string): Skill => ({
  id,
  name,
  description: null,
  instructions: '',
  tools: [],
});
const SKILLS = [skill(7, 'Cobranças'), skill(8, 'Transferir para a equipe')];
const finance: CustomRole = {
  id: 30,
  name: 'Financeiro',
  description: null,
  permissions: ['conversation_manage'],
  agent_role: 'operator',
  builtin: false,
  skill_ids: [7],
};

function renderSettings(section: SettingsSection) {
  render(
    <SettingsRouter
      route={{ page: 'settings', section }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
}

describe('profile skills', () => {
  it('links skills to a profile whose role executes', async () => {
    const api = fakeApi({
      'GET /custom_roles': [finance],
      'GET /skills': SKILLS,
      'PUT /custom_roles/30': (body) => ({ ...finance, ...(body as object) }),
    });
    const user = renderSettings('custom_roles');
    await user.click(await screen.findByRole('button', { name: 'Editar Financeiro' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar perfil' });
    expect(await within(dialog).findByLabelText('Cobranças')).toBeChecked();
    await user.click(within(dialog).getByLabelText('Transferir para a equipe'));
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'coordinator');
    expect(within(dialog).queryByText('Skills')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'operator');
    await user.click(within(dialog).getByRole('button', { name: 'Atualizar perfil' }));
    await waitFor(() => expect(api.called('PUT', '/custom_roles/30')).toHaveLength(1));
    expect(api.called('PUT', '/custom_roles/30')[0].body).toMatchObject({
      agent_role: 'operator',
      skill_ids: [7, 8],
    });
  });

  it('shows the skills an agent inherits from its profile', async () => {
    const agent: RosterAgent = {
      id: 3,
      name: 'Ana',
      kind: 'ai',
      role: 'operator',
      profile_id: 30,
      profile_name: 'Financeiro',
      description: null,
      user_id: null,
      user_name: null,
      user_email: null,
      whatsapp_jid: null,
      runtime: 'claude_cli',
      model: null,
      instructions: null,
      active: true,
      skill_ids: [8],
      profile_skill_ids: [7],
      credential_count: 0,
      created: '',
    } as RosterAgent;
    fakeApi({
      'GET /agent_directory': [agent],
      'GET /custom_roles': [finance],
      'GET /skills': SKILLS,
      'GET /agent_directory/3/credentials': [],
    });
    const user = renderSettings('agents');
    // The card lists the profile's skills and the agent's own.
    expect(await screen.findByText('Cobranças')).toBeInTheDocument();
    expect(screen.getByText('Transferir para a equipe')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar Ana' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar Ana' });
    expect(within(dialog).getByText('Herdadas do perfil Financeiro: Cobranças.')).toBeInTheDocument();
  });
});
