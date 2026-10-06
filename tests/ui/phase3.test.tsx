import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/agent/settings/SettingsPage';
import { Reports } from '../../src/agent/Reports';
import { duration } from '../../src/agent/api';
import { MessageBubble } from '../../src/agent/inbox/MessageBubble';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, message, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const renderSettings = () => {
  render(<SettingsPage user={admin} catalog={catalog} onChange={vi.fn(async () => {})} />);
  return userEvent.setup();
};

describe('inbox automatic messages', () => {
  it('saves greeting, working hours, out-of-office and CSAT', async () => {
    const api = fakeApi({
      'GET /inboxes/10/members': [admin],
      'GET /inboxes/10/working_hours': [
        { day_of_week: 1, closed_all_day: 0, open_minutes: 480, close_minutes: 1020 },
      ],
      'PATCH /inboxes/10': {},
      'PUT /inboxes/10/working_hours': [],
    });
    const user = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Caixas de entrada' }));
    expect(await screen.findByLabelText('Abre Segunda')).toHaveValue('08:00');
    expect(screen.getByLabelText('Abre Domingo')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Saudação/ }));
    await user.type(screen.getByLabelText('Texto da saudação'), 'Olá!');
    await user.click(screen.getByRole('checkbox', { name: /Horário de atendimento/ }));
    await user.click(screen.getByLabelText('Aberto Domingo'));
    const close = screen.getByLabelText('Fecha Segunda');
    await user.clear(close);
    await user.type(close, '19:30');
    await user.type(screen.getByLabelText('Mensagem de ausência'), 'Voltamos às 8h.');
    await user.click(screen.getByRole('checkbox', { name: /CSAT/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar mensagens automáticas' }));
    expect(await screen.findByText('Configurações salvas.')).toBeInTheDocument();
    expect(api.called('PATCH', '/inboxes/10')[0].body).toMatchObject({
      greeting_enabled: true,
      greeting_message: 'Olá!',
      working_hours_enabled: true,
      out_of_office_message: 'Voltamos às 8h.',
      csat_survey_enabled: true,
      timezone: 'America/Sao_Paulo',
    });
    const days = (
      api.called('PUT', '/inboxes/10/working_hours')[0].body as {
        working_hours: { closed_all_day: boolean; close_minutes: number }[];
      }
    ).working_hours;
    expect(days[0].closed_all_day).toBe(false);
    expect(days[1].close_minutes).toBe(1170);
  });

  it('shows validation errors from the server', async () => {
    fakeApi({
      'GET /inboxes/10/members': [],
      'GET /inboxes/10/working_hours': [],
      'PATCH /inboxes/10': () => {
        throw status(400, 'Fuso horário inválido');
      },
    });
    const user = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Caixas de entrada' }));
    await user.click(await screen.findByRole('button', { name: 'Salvar mensagens automáticas' }));
    expect(await screen.findByText('Fuso horário inválido')).toBeInTheDocument();
  });
});

describe('webhooks', () => {
  it('creates, toggles, inspects and deletes webhooks', async () => {
    let hooks = [
      {
        id: 1,
        url: 'https://crm.example/a',
        subscriptions: ['message_created'],
        inbox_id: null,
        secret: 'abc',
        active: 1,
      },
    ];
    const api = fakeApi({
      'GET /webhooks': () => hooks,
      'POST /webhooks': (body) => {
        hooks = [...hooks, { ...(body as (typeof hooks)[0]), id: 2, secret: 'def', active: 1 }];
        return hooks[1];
      },
      'PATCH /webhooks/1': {},
      'DELETE /webhooks/1': () => {
        hooks = hooks.slice(1);
        return { ok: true };
      },
      'GET /webhooks/1/deliveries': [
        {
          id: 1,
          event: 'message_created',
          status: 'failed',
          attempts: 5,
          response_status: 500,
          last_error: 'HTTP 500',
          created_at: 1,
        },
        {
          id: 2,
          event: 'message_created',
          status: 'sent',
          attempts: 1,
          response_status: 200,
          last_error: null,
          created_at: 2,
        },
      ],
    });
    const user = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Webhooks' }));
    expect(await screen.findByText('https://crm.example/a')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entregas' }));
    const list = await screen.findByLabelText('Entregas recentes');
    expect(within(list).getByText(/falhou \(5x\) · HTTP 500/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Ativo https://crm.example/a' }));
    await waitFor(() => expect(api.called('PATCH', '/webhooks/1')[0].body).toEqual({ active: false }));

    await user.type(screen.getByLabelText('URL'), 'https://erp.example/hook');
    await user.selectOptions(screen.getByLabelText('Caixa de entrada'), '10');
    await user.click(screen.getByRole('checkbox', { name: 'Avaliação recebida' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mensagem criada' }));
    await user.click(screen.getByRole('button', { name: 'Criar webhook' }));
    expect(await screen.findByText('https://erp.example/hook')).toBeInTheDocument();
    expect(api.called('POST', '/webhooks')[0].body).toEqual({
      url: 'https://erp.example/hook',
      subscriptions: ['csat_created'],
      inbox_id: 10,
    });
    await user.click(screen.getByRole('button', { name: 'Excluir https://crm.example/a' }));
    await waitFor(() => expect(screen.queryByText('https://crm.example/a')).not.toBeInTheDocument());
  });
});

describe('automations', () => {
  it('builds a rule with conditions and actions', async () => {
    let rules: unknown[] = [];
    const api = fakeApi({
      'GET /automation_rules': () => rules,
      'POST /automation_rules': (body) => {
        rules = [{ ...(body as object), id: 1, active: 1 }];
        return rules[0] as object;
      },
      'PATCH /automation_rules/1': {},
      'DELETE /automation_rules/1': () => {
        rules = [];
        return { ok: true };
      },
    });
    const user = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Automações' }));
    expect(await screen.findByText('Nenhuma automação ainda.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome'), 'Boletos');
    await user.selectOptions(screen.getByLabelText('Quando'), 'message_created');
    await user.type(screen.getByLabelText('Valor 1'), 'boleto');
    await user.click(screen.getByRole('button', { name: /Condição/ }));
    await user.selectOptions(screen.getByLabelText('Junção 1'), 'or');
    await user.selectOptions(screen.getByLabelText('Atributo 2'), 'inbox_id');
    await user.selectOptions(screen.getByLabelText('Valor 2'), '10');
    await user.click(screen.getByRole('button', { name: /Condição/ }));
    await user.selectOptions(screen.getByLabelText('Operador 3'), 'is_present');
    await user.click(screen.getByRole('button', { name: 'Remover condição 3' }));
    await user.selectOptions(screen.getByLabelText('Parâmetro 1'), 'vip');
    await user.click(screen.getByRole('button', { name: /Ação/ }));
    await user.selectOptions(screen.getByLabelText('Ação 2'), 'send_message');
    await user.type(screen.getByLabelText('Parâmetro 2'), 'Já encaminhei.');
    await user.click(screen.getByRole('button', { name: /Ação/ }));
    await user.selectOptions(screen.getByLabelText('Ação 3'), 'resolve_conversation');
    expect(screen.queryByLabelText('Parâmetro 3')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ação/ }));
    await user.click(screen.getByRole('button', { name: 'Remover ação 4' }));
    await user.click(screen.getByRole('button', { name: 'Criar automação' }));
    expect(await screen.findByText('Boletos')).toBeInTheDocument();
    expect(api.called('POST', '/automation_rules')[0].body).toEqual({
      name: 'Boletos',
      event_name: 'message_created',
      conditions: [
        { attribute_key: 'content', filter_operator: 'contains', values: ['boleto'], query_operator: 'or' },
        { attribute_key: 'inbox_id', filter_operator: 'contains', values: ['10'], query_operator: 'and' },
      ],
      actions: [
        { action_name: 'add_label', action_params: ['vip'] },
        { action_name: 'send_message', action_params: ['Já encaminhei.'] },
        { action_name: 'resolve_conversation', action_params: [] },
      ],
    });
    expect(screen.getByLabelText('Nome')).toHaveValue('');
    await user.click(screen.getByRole('checkbox', { name: 'Ativa Boletos' }));
    await waitFor(() => expect(api.called('PATCH', '/automation_rules/1')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Excluir Boletos' }));
    expect(await screen.findByText('Nenhuma automação ainda.')).toBeInTheDocument();
  });

  it('offers entity pickers for agents, teams, priorities, status and message type', async () => {
    fakeApi({ 'GET /automation_rules': [] });
    const user = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Automações' }));
    for (const [action, option] of [
      ['assign_agent', 'Maria Souza'],
      ['assign_team', 'Financeiro'],
      ['set_priority', 'Urgente'],
    ]) {
      await user.selectOptions(screen.getByLabelText('Ação 1'), action);
      expect(
        within(screen.getByLabelText('Parâmetro 1')).getByRole('option', { name: option }),
      ).toBeInTheDocument();
    }
    for (const [attribute, option] of [
      ['status', 'Resolvida'],
      ['message_type', 'Recebida'],
      ['assignee_id', 'Admin'],
      ['team_id', 'Financeiro'],
      ['labels', 'vip'],
    ]) {
      await user.selectOptions(screen.getByLabelText('Atributo 1'), attribute);
      expect(
        within(screen.getByLabelText('Valor 1')).getByRole('option', { name: option }),
      ).toBeInTheDocument();
    }
  });
});

describe('reports', () => {
  it('shows KPIs, agents and CSAT for the chosen period and inbox', async () => {
    const api = fakeApi({
      'GET /reports/summary': {
        conversations: 12,
        incoming_messages: 40,
        outgoing_messages: 35,
        first_response: { count: 10, average: 95 },
        resolutions: { count: 8, average: 7400 },
        csat: { count: 3, average: 4.333 },
      },
      'GET /reports/agents': [
        { id: 2, name: 'Maria Souza', resolved: 5, avg_first_response: 30, avg_resolution: 3600, csat: 5 },
      ],
      'GET /csat_responses': [
        {
          id: 1,
          display_id: 7,
          contact_name: 'João',
          assignee_name: 'Maria Souza',
          rating: 5,
          feedback: 'ótimo',
        },
        { id: 2, display_id: 8, contact_name: null, assignee_name: null, rating: 2, feedback: null },
      ],
    });
    const user = userEvent.setup();
    render(<Reports inboxes={[inbox]} />);
    expect(await screen.findByText('40 / 35')).toBeInTheDocument();
    expect(screen.getByText('2min')).toBeInTheDocument();
    expect(screen.getByText('2h 3min')).toBeInTheDocument();
    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('Maria Souza · “ótimo”')).toBeInTheDocument();
    expect(screen.getByText('Sem responsável')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Período'), '30');
    await user.selectOptions(screen.getByLabelText('Caixa de entrada'), '10');
    await waitFor(() =>
      expect(api.called('GET', '/reports/summary').at(-1)!.search).toContain('inbox_id=10'),
    );
    api.route('GET /reports/summary', () => {
      throw status(403, 'Somente administradores podem fazer isso');
    });
    await user.selectOptions(screen.getByLabelText('Período'), '1');
    expect(await screen.findByText('Somente administradores podem fazer isso')).toBeInTheDocument();
  });

  it('formats durations and labels automated messages', () => {
    expect([duration(null), duration(45), duration(600), duration(3600), duration(5400)]).toEqual([
      '—',
      '45s',
      '10min',
      '1h',
      '1h 30min',
    ]);
    render(
      <MessageBubble
        message={message(1, {
          message_type: 'outgoing',
          sender_type: 'system',
          sender_name: null,
          content_attributes: { automated: 'Saudação' },
        })}
      />,
    );
    expect(screen.getByText('Saudação')).toBeInTheDocument();
  });
});
