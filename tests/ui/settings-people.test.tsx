import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog = {
  inboxes: [inbox],
  agents: [admin, maria, { ...maria, id: 3, name: 'Inativo', active: 0 }],
  teams: [team],
  labels,
};

function renderSettings(section: SettingsSection, id?: number, current = catalog) {
  const onChange = vi.fn(async () => {});
  const onNavigate = vi.fn();
  const view = render(
    <SettingsRouter
      route={{ page: 'settings', section, id }}
      user={admin}
      catalog={current}
      onNavigate={onNavigate}
      onChange={onChange}
    />,
  );
  return { onChange, onNavigate, view, user: userEvent.setup() };
}

describe('agents', () => {
  it('lists, searches, adds and edits agents', async () => {
    const api = fakeApi({
      'POST /agents': (body) => {
        if ((body as { email: string }).email === 'dup@example.com')
          throw status(409, 'E-mail já cadastrado');
        return { id: 9 };
      },
      'PATCH /agents/2': {},
    });
    const { user, onChange } = renderSettings('agents');
    expect(screen.getByText('3 agentes')).toBeInTheDocument();
    expect(screen.getByText(/\(você\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pesquisar agentes…'), 'maria');
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Pesquisar agentes…'));

    await user.click(screen.getByRole('button', { name: 'Adicionar agente' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar agente' });
    await user.type(within(dialog).getByLabelText('Nome do agente'), 'Ana');
    await user.type(within(dialog).getByLabelText('E-mail'), 'dup@example.com');
    await user.type(within(dialog).getByLabelText(/Senha inicial/), 'senha-segura-123');
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'administrator');
    await user.click(within(dialog).getByLabelText('Suporte'));
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar agente' }));
    expect(await within(dialog).findByText('E-mail já cadastrado')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('E-mail'));
    await user.type(within(dialog).getByLabelText('E-mail'), 'ana@example.com');
    await user.click(within(dialog).getByLabelText('Suporte'));
    await user.click(within(dialog).getByLabelText('Suporte'));
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar agente' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.called('POST', '/agents')[1].body).toMatchObject({
      email: 'ana@example.com',
      role: 'administrator',
      inbox_ids: [10],
    });

    await user.click(screen.getByRole('button', { name: 'Editar Maria Souza' }));
    const edit = screen.getByRole('dialog', { name: 'Editar Maria Souza' });
    await user.selectOptions(within(edit).getByLabelText('Função'), 'administrator');
    await user.click(within(edit).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/agents/2')[0].body).toEqual({
        name: 'Maria Souza',
        role: 'administrator',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Editar Maria Souza' }));
    await user.click(screen.getByRole('button', { name: 'Desativar acesso' }));
    await waitFor(() => expect(api.called('PATCH', '/agents/2')[1].body).toEqual({ active: false }));
    await user.click(screen.getByRole('button', { name: 'Editar Inativo' }));
    expect(screen.getByRole('button', { name: 'Reativar acesso' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onChange).toHaveBeenCalled();
  });
});

describe('teams', () => {
  it('creates teams and opens a team page', async () => {
    const api = fakeApi({ 'POST /teams': { id: 6 } });
    const { user, onNavigate } = renderSettings('teams');
    expect(screen.getByText(/1 membro\(s\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar novo time' }));
    const dialog = screen.getByRole('dialog', { name: 'Criar novo time' });
    await user.type(within(dialog).getByLabelText('Nome do time'), 'Vendas');
    await user.click(within(dialog).getByRole('button', { name: 'Criar time' }));
    await waitFor(() =>
      expect(api.called('POST', '/teams')[0].body).toEqual({ name: 'Vendas', description: null }),
    );
    await user.click(screen.getByRole('button', { name: 'Configurar Financeiro' }));
    expect(onNavigate).toHaveBeenCalledWith({ page: 'settings', section: 'teams', id: 5 });
  });

  it('edits members, auto-assign and deletes a team', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = fakeApi({
      'GET /teams/5/members': [admin],
      'POST /teams/5/members': [admin, maria],
      'DELETE /teams/5/members': [maria],
      'PATCH /teams/5': {},
      'DELETE /teams/5': { ok: true },
    });
    const { user, onNavigate } = renderSettings('teams', 5);
    expect(screen.getByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Membro Admin' })).toBeChecked());
    await user.click(screen.getByRole('switch', { name: 'Membro Maria Souza' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Membro Maria Souza' })).toBeChecked());
    await user.click(screen.getByRole('switch', { name: 'Membro Admin' }));
    await waitFor(() => expect(api.called('DELETE', '/teams/5/members')[0].body).toEqual({ user_ids: [1] }));
    await user.click(screen.getByRole('switch', { name: 'Atribuição automática no time' }));
    expect(api.called('PATCH', '/teams/5')[0].body).toEqual({ allow_auto_assign: false });
    await user.click(screen.getByRole('button', { name: 'Excluir time' }));
    expect(api.called('DELETE', '/teams/5')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Excluir time' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ page: 'settings', section: 'teams' }));
  });

  it('shows the empty list', () => {
    fakeApi({});
    renderSettings('teams', undefined, { ...catalog, teams: [] });
    expect(screen.getByText('Nenhum time ainda.')).toBeInTheDocument();
  });
});

describe('inboxes', () => {
  it('lists inboxes and opens their settings', async () => {
    fakeApi({});
    const { user, onNavigate } = renderSettings('inboxes');
    expect(screen.getByText(/WhatsApp · \+5511999999999 · conectado/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Configurar Suporte' }));
    expect(onNavigate).toHaveBeenCalledWith({ page: 'settings', section: 'inboxes', id: 10 });
  });

  it('edits settings, collaborators, hours and automatic messages', async () => {
    const api = fakeApi({
      'GET /inboxes/10/members': [admin],
      'POST /inboxes/10/members': [admin, maria],
      'PATCH /inboxes/10': {},
      'GET /inboxes/10/working_hours': [
        { day_of_week: 1, closed_all_day: 0, open_minutes: 480, close_minutes: 1020 },
      ],
      'PUT /inboxes/10/working_hours': [],
    });
    const { user, onNavigate } = renderSettings('inboxes', 10);
    const name = screen.getByLabelText('Nome da caixa');
    await user.clear(name);
    await user.type(name, 'Vendas');
    await user.click(screen.getByRole('button', { name: 'Renomear' }));
    await user.click(screen.getByRole('switch', { name: 'Atendimento por IA (MCP)' }));
    await user.click(screen.getByRole('switch', { name: 'Ignorar grupos' }));
    await user.click(screen.getByRole('switch', { name: 'Atribuição automática' }));
    await user.click(screen.getByRole('switch', { name: 'Uma conversa por contato' }));
    expect(api.called('PATCH', '/inboxes/10').map((c) => c.body)).toEqual([
      { name: 'Vendas' },
      { agent_bot_enabled: true },
      { ignore_groups: false },
      { enable_auto_assignment: false },
      { lock_to_single_conversation: false },
    ]);

    await user.click(screen.getByRole('tab', { name: 'Colaboradores' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Acesso Admin' })).toBeChecked());
    await user.click(screen.getByRole('switch', { name: 'Acesso Maria Souza' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Acesso Maria Souza' })).toBeChecked());

    await user.click(screen.getByRole('tab', { name: 'Horário e mensagens' }));
    expect(await screen.findByLabelText('Abre Segunda')).toHaveValue('08:00');
    expect(screen.getByLabelText('Abre Domingo')).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Saudação' }));
    await user.type(screen.getByLabelText('Texto da saudação'), 'Olá!');
    await user.click(screen.getByRole('switch', { name: 'Horário de atendimento' }));
    await user.click(screen.getByLabelText('Aberto Domingo'));
    const close = screen.getByLabelText('Fecha Segunda');
    await user.clear(close);
    await user.type(close, '19:30');
    await user.clear(screen.getByLabelText('Abre Segunda'));
    await user.type(screen.getByLabelText('Abre Segunda'), '07:00');
    await user.type(screen.getByLabelText('Mensagem de ausência'), 'Voltamos às 8h.');
    await user.clear(screen.getByLabelText('Fuso horário'));
    await user.type(screen.getByLabelText('Fuso horário'), 'UTC');
    await user.click(screen.getByRole('switch', { name: 'Pesquisa de satisfação (CSAT)' }));
    await user.click(screen.getByRole('button', { name: 'Salvar mensagens automáticas' }));
    expect(await screen.findByText('Configurações salvas.')).toBeInTheDocument();
    expect(api.called('PATCH', '/inboxes/10').at(-1)!.body).toMatchObject({
      greeting_enabled: true,
      greeting_message: 'Olá!',
      working_hours_enabled: true,
      out_of_office_message: 'Voltamos às 8h.',
      csat_survey_enabled: true,
      timezone: 'UTC',
    });
    const days = (
      api.called('PUT', '/inboxes/10/working_hours')[0].body as {
        working_hours: { open_minutes: number; close_minutes: number; closed_all_day: boolean }[];
      }
    ).working_hours;
    expect([days[0].closed_all_day, days[1].open_minutes, days[1].close_minutes]).toEqual([false, 420, 1170]);
    await user.click(screen.getByRole('button', { name: /Caixas de entrada/ }));
    expect(onNavigate).toHaveBeenCalledWith({ page: 'settings', section: 'inboxes' });
  });

  it('reports failures and shows the empty list', async () => {
    fakeApi({
      'GET /inboxes/10/members': () => {
        throw status(500, 'x');
      },
      'GET /inboxes/10/working_hours': () => {
        throw status(500, 'x');
      },
      'PATCH /inboxes/10': () => {
        throw status(400, 'Fuso horário inválido');
      },
    });
    const { user, view } = renderSettings('inboxes', 10);
    await user.click(screen.getByRole('tab', { name: 'Horário e mensagens' }));
    await user.click(screen.getByRole('button', { name: 'Salvar mensagens automáticas' }));
    expect(await screen.findByText('Fuso horário inválido')).toBeInTheDocument();
    view.unmount();
    renderSettings('inboxes', undefined, { ...catalog, inboxes: [] });
    expect(screen.getByText('Nenhuma caixa de entrada.')).toBeInTheDocument();
  });
});
