import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
// Pré-carrega os chunks das páginas lazy usadas no teste (Relatórios/Configurações) fora do tempo da asserção.
import '../../src/agent/Reports';
import '../../src/agent/settings/AccountPage';
import '../../src/agent/settings/SlaPage';
import '../../src/agent/settings/TeamsPage';
import * as navTools from './nav';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, maria, workspaceRoutes } from './fixtures';
import { row, summary } from './report-fixtures';

describe('login', () => {
  it('reports bad credentials, then enters the workspace with CSRF on later calls', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /auth/me': () => {
        throw status(401, 'Faça login para continuar');
      },
      'POST /auth/login': (body) => {
        if ((body as { password: string }).password !== 'senha-segura-123')
          throw status(401, 'E-mail ou senha inválidos');
        return { user: admin, csrf: 'csrf-1' };
      },
      'PATCH /profile': { ...admin, availability: 'busy' },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await user.type(await screen.findByLabelText('E-mail'), 'admin@example.com');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos');
    await user.clear(screen.getByLabelText('Senha'));
    await user.type(screen.getByLabelText('Senha'), 'senha-segura-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: /Ocupado/ }));
    await waitFor(() => expect(api.called('PATCH', '/profile')[0].headers['X-CSRF-Token']).toBe('csrf-1'));
  });
});

describe('sidebar', () => {
  it('navigates groups, scopes the conversation list and logs out', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /contacts': [],
      'GET /reports/summary_v2': summary,
      'GET /reports': [],
      'POST /auth/logout': { ok: true },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(await within(navTools.nav()).findByText('3')).toBeInTheDocument();

    await navTools.click(user, 'Suporte');
    expect(await screen.findByRole('heading', { name: 'Suporte' })).toBeInTheDocument();
    await waitFor(() => expect(api.called('GET', '/conversations').at(-1)!.search).toContain('inbox_id=10'));
    await navTools.click(user, 'Financeiro');
    await waitFor(() => expect(api.called('GET', '/conversations').at(-1)!.search).toContain('team_id=5'));
    await navTools.click(user, 'vip');
    expect(await screen.findByRole('heading', { name: '#vip' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pesquisar conversas'), 'joão{Enter}');
    expect(await screen.findByRole('heading', { name: 'Busca: “joão”' })).toBeInTheDocument();
    await navTools.click(user, 'Todas as conversas');
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();

    await navTools.click(user, 'Conversas');
    await navTools.click(user, 'Contatos');
    expect(await screen.findByRole('heading', { name: 'Contatos' })).toBeInTheDocument();
    await navTools.click(user, 'Relatórios');
    await navTools.click(user, 'Visão geral');
    expect(
      await screen.findByRole('heading', { name: 'Visão geral' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    await navTools.click(user, 'Configurações');
    await navTools.click(user, 'Funcionários');
    expect(
      await screen.findByRole('heading', { name: 'Funcionários' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    await navTools.click(user, 'Configurações');

    FakeEventSource.instances[0].onopen?.();
    FakeEventSource.emit('presence.update', {});
    FakeEventSource.emit('notification.created', { id: 9 });
    expect(await within(navTools.nav()).findByText('4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sair' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('opens each report page and the new settings pages', async () => {
    fakeApi({
      ...workspaceRoutes(),
      'GET /reports/summary_v2': summary,
      'GET /reports': [],
      'GET /reports/breakdown/team': [row(5, 'Financeiro')],
      'GET /account': { id: 1, name: 'Loja', locale: 'pt-BR', settings: {} },
      'GET /sla_policies': [],
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await navTools.click(user, 'Relatórios');
    await navTools.click(user, 'Visão geral');
    expect(
      await screen.findByRole('heading', { name: 'Visão geral' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    await navTools.click(user, 'Times');
    expect(await screen.findByRole('button', { name: 'Financeiro' }, { timeout: 8000 })).toBeInTheDocument();
    expect(navTools.navItem('Times')).toHaveAttribute('href', expect.stringContaining('section=teams'));
    await navTools.click(user, 'Configurações');
    await navTools.click(user, 'Configurações da conta');
    expect(await screen.findByLabelText('Nome da conta', {}, { timeout: 8000 })).toHaveValue('Loja');
    await user.click(screen.getAllByRole('link', { name: 'SLA' }).at(-1)!);
    expect(await screen.findByText('Nenhum SLA ainda.', {}, { timeout: 8000 })).toBeInTheDocument();
  });

  it('hides reports and settings from agents', async () => {
    fakeApi(workspaceRoutes(maria));
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(navTools.navQuery('Configurações')).not.toBeInTheDocument();
    expect(navTools.navQuery('Relatórios')).not.toBeInTheDocument();
  });
});

describe('notifications inbox', () => {
  it('lists notifications, marks them read and opens the conversation', async () => {
    const items = [
      {
        id: 1,
        notification_type: 'conversation_assignment',
        display_id: 7,
        contact_name: 'João',
        actor_name: 'Ana',
        read_at: null,
        created_at: 1,
      },
      {
        id: 2,
        notification_type: 'assigned_conversation_new_message',
        display_id: 7,
        contact_name: null,
        actor_name: null,
        read_at: 5,
        created_at: 2,
      },
      {
        id: 3,
        notification_type: 'conversation_creation',
        display_id: 8,
        contact_name: 'Bia',
        actor_name: null,
        read_at: 5,
        created_at: 3,
      },
      {
        id: 4,
        notification_type: 'other_type',
        display_id: null,
        contact_name: 'X',
        actor_name: null,
        read_at: 5,
        created_at: 4,
      },
    ];
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /notifications': { items, unread: 1 },
      'PATCH /notifications/1': { unread: 0 },
      'POST /notifications/read_all': { unread: 0 },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await navTools.click(user, /Caixa de entrada/);
    expect(await screen.findByText('Ana atribuiu a você a conversa #7')).toBeInTheDocument();
    expect(screen.getByText('Nova mensagem em #7')).toBeInTheDocument();
    expect(screen.getByText('Nova conversa #8')).toBeInTheDocument();
    expect(screen.getByText('other_type')).toBeInTheDocument();
    FakeEventSource.emit('notification.created', { id: 5 });
    await waitFor(() => expect(api.called('GET', '/notifications').length).toBeGreaterThan(1));
    await user.click(screen.getByRole('button', { name: /Marcar tudo como lido/ }));
    await waitFor(() => expect(api.called('POST', '/notifications/read_all')).toHaveLength(1));
    await user.click(screen.getByText('Ana atribuiu a você a conversa #7'));
    await waitFor(() => expect(api.called('PATCH', '/notifications/1')).toHaveLength(1));
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    fakeApi({ ...workspaceRoutes(), 'GET /notifications': { items: [], unread: 0 } });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await navTools.click(user, /Caixa de entrada/);
    expect(await screen.findByText('Nenhuma notificação por aqui.')).toBeInTheDocument();
  });
});
