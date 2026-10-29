import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { RosterAgent, SalarySheet } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi } from './fake-api';
import { admin, inbox, labels, team } from './fixtures';

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
  model: 'sonnet',
  instructions: 'Atenda bem.',
  active: true,
  skill_ids: [],
  credential_count: 0,
  supervisor_id: null,
  avatar: {},
  ...fields,
});
const JOAO = roster(1, {
  name: 'João',
  kind: 'human',
  role: null,
  profile_name: 'Padrão',
  runtime: null,
  model: null,
  instructions: null,
  whatsapp_jid: '5511977776666@s.whatsapp.net',
  availability: 'online',
});
const ANNY = roster(2, { name: 'Anny', role: 'coordinator', profile_name: 'Coordenador de IA' });
const LU = roster(3, { name: 'Lu', description: 'Recepcionista da software house.', skill_ids: [7] });
const SHEET: SalarySheet = {
  month: '2026-10',
  rates: { seat_price_brl: 50, ai_margin_percent: 50, usd_brl_rate: 5.5 },
  salaries: [
    {
      agent_id: 1,
      kind: 'human',
      salary_brl: 50,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      unpriced_calls: 0,
    },
    {
      agent_id: 2,
      kind: 'ai',
      salary_brl: 0,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      unpriced_calls: 0,
    },
    {
      agent_id: 3,
      kind: 'ai',
      salary_brl: 0.33,
      calls: 2,
      input_tokens: 2400,
      output_tokens: 600,
      cost_usd: 0.04,
      unpriced_calls: 0,
    },
  ],
};
const catalog: Catalog = {
  inboxes: [{ ...inbox, ai_agent_id: 3 }],
  agents: [admin],
  teams: [team],
  labels,
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

describe('Funcionários', () => {
  it('shows each member with its kind, status and salary, and opens the detail tabs', async () => {
    let agents = [JOAO, ANNY, LU];
    const api = fakeApi({
      'GET /agent_directory': () => agents,
      'GET /agent_directory/salaries': SHEET,
      'GET /agent_directory/3/usage': [
        { day: '2026-10-28', input_tokens: 2400, output_tokens: 600, cost_usd: 0.04 },
      ],
      'GET /custom_roles': [],
      'GET /skills': [
        {
          id: 7,
          name: 'Atendimento',
          description: 'Recebe clientes',
          instructions: '',
          tools: ['reply_conversation'],
        },
      ],
      'PUT /agent_directory/3': (body) => {
        agents = agents.map((a) => (a.id === 3 ? { ...a, ...(body as Partial<RosterAgent>) } : a));
        return agents[2];
      },
      'PUT /agent_directory/3/avatar': (body) => ({ ...LU, avatar: body }),
    });
    const user = renderSettings('agents');
    expect(await screen.findByRole('heading', { name: 'Funcionários' })).toBeInTheDocument();
    const joao = await screen.findByRole('article', { name: 'João' });
    expect(within(joao).getByText('Pessoa')).toBeInTheDocument();
    expect(within(joao).getByText('Online')).toBeInTheDocument();
    expect(within(joao).getByText(/R\$\s50,00\/mês/)).toBeInTheDocument();
    const lu = screen.getByRole('article', { name: 'Lu' });
    expect(within(lu).getByText(/R\$\s0,33 no mês/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Anny' })).getByText(/R\$\s0,00 no mês/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Folha do mês')).toHaveTextContent('50,33');

    await user.click(screen.getByRole('button', { name: 'Pessoas' }));
    expect(screen.queryByRole('article', { name: 'Lu' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Todos' }));

    await user.click(
      within(screen.getByRole('article', { name: 'Lu' })).getByRole('button', { name: 'Abrir Lu' }),
    );
    const pane = screen.getByRole('complementary', { name: 'Detalhes de Lu' });
    expect(within(pane).getByText('“Recepcionista da software house.”')).toBeInTheDocument();
    expect(within(pane).getByText(/Começa o mês em R\$ 0/)).toBeInTheDocument();
    expect(within(pane).getByText('Suporte')).toBeInTheDocument();
    expect(await within(pane).findByRole('img', { name: /Tokens nos últimos 30 dias/ })).toBeInTheDocument();
    await user.click(within(pane).getByRole('tab', { name: 'Habilidades' }));
    expect(within(pane).getByText('Atendimento')).toBeInTheDocument();
    await user.click(within(pane).getByRole('tab', { name: 'Ferramentas' }));
    expect(within(pane).getByText('reply_conversation')).toBeInTheDocument();
    await user.click(within(pane).getByRole('tab', { name: 'Memória' }));
    expect(within(pane).getByText(/runtime agêntico/)).toBeInTheDocument();

    await user.click(within(pane).getByRole('tab', { name: 'Configurações' }));
    await user.selectOptions(within(pane).getByLabelText('Responde a'), '2');
    await waitFor(() => expect(api.called('PUT', '/agent_directory/3')).toHaveLength(1));
    expect(api.called('PUT', '/agent_directory/3')[0].body).toEqual({
      name: 'Lu',
      kind: 'ai',
      profile_id: 21,
      description: 'Recepcionista da software house.',
      active: true,
      supervisor_id: 2,
      runtime: 'claude_cli',
      model: 'sonnet',
      instructions: 'Atenda bem.',
    });
    await user.selectOptions(within(pane).getByLabelText('Cabelo'), 'curly');
    await user.click(within(pane).getByRole('button', { name: 'Salvar avatar' }));
    await waitFor(() => expect(api.called('PUT', '/agent_directory/3/avatar')).toHaveLength(1));
    expect(api.called('PUT', '/agent_directory/3/avatar')[0].body).toMatchObject({ hair: 'curly' });
  });
});

describe('Funcionários without salaries', () => {
  it('still lists the members when the salary sheet is not available', async () => {
    fakeApi({
      'GET /agent_directory': [JOAO, LU],
      'GET /agent_directory/salaries': [],
      'GET /custom_roles': [],
      'GET /skills': [],
    });
    renderSettings('agents');
    expect(await screen.findByRole('article', { name: 'Lu' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Folha do mês')).not.toBeInTheDocument();
  });
});

describe('Organização', () => {
  it('draws who answers to whom, where each inbox goes and what is off', async () => {
    let agents = [JOAO, ANNY, { ...LU, supervisor_id: 2 }, roster(4, { name: 'Julio', role: 'qa' })];
    const api = fakeApi({
      'GET /agent_directory': () => agents,
      'PUT /agent_directory/4': (body) => {
        agents = agents.map((a) => (a.id === 4 ? { ...a, ...(body as Partial<RosterAgent>) } : a));
        return agents[3];
      },
    });
    const user = renderSettings('organization');
    const tree = await screen.findByRole('tree', { name: 'Organograma' });
    const anny = within(tree).getByRole('treeitem', { name: 'Anny' });
    expect(within(anny).getByRole('treeitem', { name: 'Lu' })).toBeInTheDocument();
    expect(within(anny).queryByRole('treeitem', { name: 'Julio' })).not.toBeInTheDocument();

    const flow = screen.getByRole('region', { name: 'Fluxo das conversas' });
    expect(flow).toHaveTextContent('Suporte');
    expect(flow).toHaveTextContent('Lu');
    expect(flow).toHaveTextContent('escala para Anny');
    expect(screen.getByRole('region', { name: 'Pontos de atenção' })).toHaveTextContent(
      'Julio executa, mas não responde a ninguém',
    );

    await user.selectOptions(screen.getByLabelText('Julio responde a'), '2');
    await waitFor(() => expect(api.called('PUT', '/agent_directory/4')).toHaveLength(1));
    expect(api.called('PUT', '/agent_directory/4')[0].body).toMatchObject({ supervisor_id: 2, kind: 'ai' });
    expect(
      await within(screen.getByRole('treeitem', { name: 'Anny' })).findByRole('treeitem', { name: 'Julio' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pontos de atenção' })).not.toBeInTheDocument();
  });
});

describe('Salário digital', () => {
  it('saves the seat, the AI margin and the dollar rate on the account', async () => {
    const api = fakeApi({
      'GET /account': { id: 1, name: 'Software house', locale: 'pt-BR', settings: { seat_price_brl: 50 } },
      'PATCH /account': {},
    });
    const user = renderSettings('account');
    const form = await screen.findByRole('form', { name: 'Salário digital' });
    expect(within(form).getByLabelText('Margem sobre a IA (%)')).toHaveValue(50);
    await user.clear(within(form).getByLabelText('Assento por pessoa (R$/mês)'));
    await user.type(within(form).getByLabelText('Assento por pessoa (R$/mês)'), '80');
    await user.click(within(form).getByRole('button', { name: 'Salvar valores' }));
    expect(await within(form).findByText('Valores do salário digital salvos.')).toBeInTheDocument();
    expect(api.called('PATCH', '/account')[0].body).toEqual({
      seat_price_brl: 80,
      ai_margin_percent: 50,
      usd_brl_rate: 5.5,
    });
  });
});
