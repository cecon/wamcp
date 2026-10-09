import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { SettingsSection } from '../../src/agent/route';
import { splitThreshold, toSeconds } from '../../src/agent/sla/sla';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
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
const account = {
  id: 1,
  name: 'Loja',
  locale: 'pt-BR',
  settings: { auto_resolve_duration: 3, auto_resolve_message: 'Encerramos por inatividade.' },
};

describe('account settings', () => {
  it('edits name, language and auto-resolve', async () => {
    const api = fakeApi({ 'GET /account': account, 'PATCH /account': account });
    const { user } = renderSettings('account');
    const name = await screen.findByLabelText('Nome da conta');
    expect(screen.getByLabelText('Dias de inatividade')).toHaveValue(3);
    await user.clear(name);
    await user.type(name, 'Loja Centro');
    await user.selectOptions(screen.getByLabelText('Idioma'), 'es');
    await user.clear(screen.getByLabelText('Dias de inatividade'));
    await user.type(screen.getByLabelText('Dias de inatividade'), '10');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Configurações da conta salvas.')).toBeInTheDocument();
    expect(api.called('PATCH', '/account')[0].body).toEqual({
      name: 'Loja Centro',
      locale: 'es',
      auto_resolve_duration: 10,
      auto_resolve_message: 'Encerramos por inatividade.',
    });
    await user.click(screen.getByRole('switch', { name: 'Resolver conversas inativas automaticamente' }));
    expect(screen.queryByLabelText('Dias de inatividade')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Mensagem da resolução automática'));
    api.route('PATCH /account', () => {
      throw status(400, 'Dados inválidos');
    });
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Dados inválidos')).toBeInTheDocument();
    expect(api.called('PATCH', '/account')[1].body).toMatchObject({
      auto_resolve_duration: null,
      auto_resolve_message: null,
    });
  });

  it('enables auto-resolve from an account without settings and reports load errors', async () => {
    const api = fakeApi({ 'GET /account': { ...account, settings: null }, 'PATCH /account': account });
    const { user } = renderSettings('account');
    await user.click(
      await screen.findByRole('switch', { name: 'Resolver conversas inativas automaticamente' }),
    );
    expect(screen.getByLabelText('Dias de inatividade')).toHaveValue(7);
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/account')[0].body).toMatchObject({ auto_resolve_duration: 7 }),
    );
    api.route('GET /account', () => {
      throw status(500, 'Falha ao carregar');
    });
    renderSettings('account');
    expect(await screen.findByText('Falha ao carregar')).toBeInTheDocument();
  });
});

describe('SLA settings', () => {
  const policy = {
    id: 3,
    name: 'Ouro',
    description: 'Clientes VIP',
    first_response_time_threshold: 1800,
    next_response_time_threshold: null,
    resolution_time_threshold: 172800,
  };

  it('creates, edits and deletes policies with thresholds in seconds', async () => {
    const api = fakeApi({
      'GET /sla_policies': [policy],
      'POST /sla_policies': { ...policy, id: 4 },
      'PUT /sla_policies/3': policy,
      'DELETE /sla_policies/3': { ok: true },
    });
    const { user } = renderSettings('sla');
    expect(await screen.findByText('Ouro')).toBeInTheDocument();
    expect(screen.getByText('30min')).toBeInTheDocument();
    expect(screen.getByText('2d')).toBeInTheDocument();
    expect(screen.getByText('1 SLA')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar SLA' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar SLA' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Prata');
    await user.type(within(dialog).getByLabelText('Primeira resposta'), '15');
    await user.selectOptions(within(dialog).getByLabelText('Unidade Primeira resposta'), 'minutes');
    await user.type(within(dialog).getByLabelText('Resolução'), '3');
    await user.selectOptions(within(dialog).getByLabelText('Unidade Resolução'), 'days');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('POST', '/sla_policies')[0].body).toEqual({
        name: 'Prata',
        description: null,
        first_response_time_threshold: 900,
        next_response_time_threshold: null,
        resolution_time_threshold: 259200,
      }),
    );
    await waitFor(() => expect(api.called('GET', '/sla_policies')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Editar Ouro' }));
    const edit = screen.getByRole('dialog', { name: 'Editar SLA' });
    expect(within(edit).getByLabelText('Primeira resposta')).toHaveValue(30);
    expect(within(edit).getByLabelText('Unidade Resolução')).toHaveValue('days');
    await user.type(within(edit).getByLabelText('Próxima resposta'), '2');
    await user.click(within(edit).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PUT', '/sla_policies/3')[0].body).toMatchObject({
        description: 'Clientes VIP',
        first_response_time_threshold: 1800,
        next_response_time_threshold: 7200,
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Excluir Ouro' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(api.called('DELETE', '/sla_policies/3')).toHaveLength(1));
  });

  it('keeps the modal open on validation errors and shows the empty list', async () => {
    fakeApi({
      'GET /sla_policies': [],
      'POST /sla_policies': () => {
        throw status(400, 'Defina ao menos um prazo');
      },
    });
    const { user } = renderSettings('sla');
    expect(await screen.findByText('Nenhum SLA ainda.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar SLA' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar SLA' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Vazio');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByText('Defina ao menos um prazo')).toBeInTheDocument();
  });

  it('converts thresholds between units and seconds', () => {
    expect(splitThreshold(null)).toEqual({ value: '', unit: 'hours' });
    expect(splitThreshold(90)).toEqual({ value: '2', unit: 'minutes' });
    expect([splitThreshold(7200), splitThreshold(86400 * 2), splitThreshold(600)]).toEqual([
      { value: '2', unit: 'hours' },
      { value: '2', unit: 'days' },
      { value: '10', unit: 'minutes' },
    ]);
    expect([toSeconds('', 'hours'), toSeconds('0', 'days'), toSeconds('1.5', 'hours')]).toEqual([
      null,
      null,
      5400,
    ]);
  });
});

describe('inbox limits and CSAT message', () => {
  it('saves the per-agent limit and the survey message', async () => {
    const api = fakeApi({
      'GET /inboxes/10/members': [admin],
      'GET /inboxes/10/working_hours': [],
      'PATCH /inboxes/10': {},
      'PUT /inboxes/10/working_hours': [],
    });
    const limited = { ...inbox, max_assignment_limit: 5, csat_survey_message: 'Avalie!' };
    const { user } = renderSettings('inboxes', 10, { ...catalog, inboxes: [limited] });
    const limit = screen.getByLabelText(/Limite de conversas por agente/);
    expect(limit).toHaveValue(5);
    expect(screen.getByRole('button', { name: 'Salvar limite' })).toBeDisabled();
    await user.clear(limit);
    await user.click(screen.getByRole('button', { name: 'Salvar limite' }));
    expect(await screen.findByText('Limite salvo.')).toBeInTheDocument();
    await user.type(limit, '12');
    await user.click(screen.getByRole('button', { name: 'Salvar limite' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/inboxes/10').map((c) => c.body)).toEqual([
        { max_assignment_limit: null },
        { max_assignment_limit: 12 },
      ]),
    );

    await user.click(screen.getByRole('tab', { name: 'Horário e mensagens' }));
    const message = await screen.findByLabelText('Mensagem da pesquisa CSAT');
    expect(message).toHaveValue('Avalie!');
    await user.clear(message);
    await user.click(screen.getByRole('button', { name: 'Salvar mensagens automáticas' }));
    expect(await screen.findByText('Configurações salvas.')).toBeInTheDocument();
    expect(api.called('PATCH', '/inboxes/10').at(-1)!.body).toMatchObject({ csat_survey_message: null });
  });
});
