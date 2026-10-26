import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { AgentCredential, CustomRole, RosterAgent, Skill } from '../../src/agent/adminTypes';
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
const profile = (
  id: number,
  name: string,
  agent_role: CustomRole['agent_role'],
  builtin = false,
): CustomRole => ({
  id,
  name,
  description: null,
  permissions: ['conversation_manage'],
  agent_role,
  builtin,
});
const PROFILES = [
  profile(1, 'Padrão', null, true),
  profile(20, 'Coordenador de IA', 'coordinator'),
  profile(21, 'Operador', 'operator'),
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
  whatsapp_jid: null,
  runtime: 'claude_cli',
  model: null,
  instructions: null,
  active: true,
  skill_ids: [],
  credential_count: 0,
  ...fields,
});

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

describe('agent roster', () => {
  it('lists human and AI agents, filters them and creates an AI operator with skills', async () => {
    let agents = [
      roster(1, { name: 'Ana', kind: 'human', runtime: null, whatsapp_jid: '5511988887777@s.whatsapp.net' }),
      roster(2, { name: 'Coordenadora', role: 'coordinator' }),
    ];
    const api = fakeApi({
      'GET /agent_directory': () => agents,
      'GET /custom_roles': PROFILES,
      'GET /skills': [skill(7, 'Pedidos'), skill(8, 'Entregas')],
      'POST /agent_directory': (body) => {
        agents = [...agents, roster(3, body as Partial<RosterAgent>)];
        return agents[2];
      },
      'PUT /agent_directory/3/skills': (body) => {
        agents[2] = { ...agents[2], skill_ids: (body as { skill_ids: number[] }).skill_ids };
        return agents[2];
      },
    });
    const user = renderSettings('agents');
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('+5511988887777')).toBeInTheDocument();
    expect(screen.queryByText('Coordenadora')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'IA' }));
    expect(await screen.findByText('Coordenadora')).toBeInTheDocument();
    expect(screen.getByText('Coordenador')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar agente de IA' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar agente de IA' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Operador de pedidos');
    expect(within(dialog).queryByRole('option', { name: 'Padrão' })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Perfil'), '20');
    expect(within(dialog).queryByText('Skills')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Perfil'), '21');
    await user.click(within(dialog).getByLabelText('Pedidos'));
    await user.type(within(dialog).getByLabelText('Modelo (opcional)'), 'sonnet');
    await user.click(within(dialog).getByRole('button', { name: 'Criar agente' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.called('POST', '/agent_directory')[0].body).toMatchObject({
      name: 'Operador de pedidos',
      kind: 'ai',
      profile_id: 21,
      runtime: 'claude_cli',
      model: 'sonnet',
    });
    expect(api.called('PUT', '/agent_directory/3/skills')[0].body).toEqual({ skill_ids: [7] });
    expect(await screen.findByText('Pedidos')).toBeInTheDocument();
  });

  it('adds a write-only credential to an executing AI agent', async () => {
    let credentials: AgentCredential[] = [];
    const api = fakeApi({
      'GET /agent_directory': [roster(4, { name: 'Operador' })],
      'GET /custom_roles': PROFILES,
      'GET /skills': [],
      'GET /agent_directory/4/credentials': () => credentials,
      'POST /agent_directory/4/credentials': (body) => {
        const { name, kind } = body as { name: string; kind: AgentCredential['kind'] };
        credentials = [{ id: 1, agent_id: 4, name, kind, created: '', last_used: null }];
        return credentials[0];
      },
    });
    const user = renderSettings('agents');
    await user.click(await screen.findByRole('tab', { name: 'IA' }));
    await user.click(await screen.findByRole('button', { name: 'Editar Operador' }));
    const panel = await screen.findByRole('region', { name: 'Credenciais' });
    await user.type(within(panel).getByLabelText('Nome da credencial'), 'erp_api');
    await user.type(within(panel).getByLabelText('Segredo'), 'sk-123');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar credencial' }));
    expect(await within(panel).findByText('erp_api')).toBeInTheDocument();
    expect(api.called('POST', '/agent_directory/4/credentials')[0].body).toEqual({
      name: 'erp_api',
      kind: 'api_key',
      secret: 'sk-123',
    });
    expect(within(panel).queryByText('sk-123')).not.toBeInTheDocument();
    expect(within(panel).getByLabelText('Segredo')).toHaveValue('');
  });
});

describe('linking skills from the agent form', () => {
  it('creates a skill inline and links it to the new agent', async () => {
    const api = fakeApi({
      'GET /agent_directory': [],
      'GET /custom_roles': PROFILES,
      'GET /skills': [],
      'POST /skills': (body) => ({ ...skill(9, (body as Skill).name), tools: (body as Skill).tools }),
      'POST /agent_directory': (body) => roster(5, body as Partial<RosterAgent>),
      'PUT /agent_directory/5/skills': (body) => roster(5, body as Partial<RosterAgent>),
    });
    const user = renderSettings('agents');
    await user.click(await screen.findByRole('tab', { name: 'IA' }));
    await user.click(await screen.findByRole('button', { name: 'Adicionar agente de IA' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar agente de IA' });
    expect(within(dialog).getByText(/Nenhuma skill ainda/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /OpenRouter (API)/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Nova skill' }));
    await user.type(within(dialog).getByLabelText('Nome da nova skill'), 'Cobrança');
    await user.type(
      within(dialog).getByLabelText('Ferramentas da nova skill'),
      'reply_conversation, http_request',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Criar e vincular' }));
    expect(await within(dialog).findByLabelText('Cobrança')).toBeChecked();
    expect(api.called('POST', '/skills')[0].body).toEqual({
      name: 'Cobrança',
      instructions: '',
      tools: ['reply_conversation', 'http_request'],
    });
    await user.type(within(dialog).getByLabelText('Nome'), 'Cobrador');
    await user.click(within(dialog).getByRole('button', { name: 'Criar agente' }));
    await waitFor(() => expect(api.called('PUT', '/agent_directory/5/skills')).toHaveLength(1));
    expect(api.called('PUT', '/agent_directory/5/skills')[0].body).toEqual({ skill_ids: [9] });
  });
});

describe('skills', () => {
  it('imports a SKILL.md file', async () => {
    let skills: Skill[] = [];
    const api = fakeApi({
      'GET /custom_roles': PROFILES,
      'GET /skills': () => skills,
      'POST /skills/import': () => {
        skills = [{ ...skill(1, 'Entregas'), tools: ['http_request'] }];
        return skills[0];
      },
    });
    const user = renderSettings('skills');
    expect(await screen.findByText('Nenhuma skill ainda.')).toBeInTheDocument();
    const content = '---\nname: Entregas\n---\nCalcule o frete.';
    await user.upload(screen.getByLabelText('Arquivo SKILL.md'), new File([content], 'SKILL.md'));
    expect(await screen.findByText('Entregas')).toBeInTheDocument();
    expect(screen.getByText('http_request')).toBeInTheDocument();
    expect(api.called('POST', '/skills/import')[0].body).toEqual({ content });
  });
});
