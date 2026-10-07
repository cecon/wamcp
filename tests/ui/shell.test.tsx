import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, maria, workspaceRoutes } from './fixtures';

const nav = () => screen.getByRole('navigation');

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
      'GET /reports/summary': {
        conversations: 0,
        incoming_messages: 0,
        outgoing_messages: 0,
        first_response: { count: 0, average: null },
        resolutions: { count: 0, average: null },
        csat: { count: 0, average: null },
      },
      'GET /reports/agents': [],
      'GET /csat_responses': [],
      'POST /auth/logout': { ok: true },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(await within(nav()).findByText('3')).toBeInTheDocument();

    await user.click(within(nav()).getByRole('button', { name: 'Suporte' }));
    expect(await screen.findByRole('heading', { name: 'Suporte' })).toBeInTheDocument();
    await waitFor(() => expect(api.called('GET', '/conversations').at(-1)!.search).toContain('inbox_id=10'));
    await user.click(within(nav()).getByRole('button', { name: 'Financeiro' }));
    await waitFor(() => expect(api.called('GET', '/conversations').at(-1)!.search).toContain('team_id=5'));
    await user.click(within(nav()).getByRole('button', { name: 'vip' }));
    expect(await screen.findByRole('heading', { name: '#vip' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pesquisar conversas'), 'joão{Enter}');
    expect(await screen.findByRole('heading', { name: 'Busca: “joão”' })).toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Todas as conversas' }));
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();

    await user.click(within(nav()).getByRole('button', { name: 'Conversas' }));
    expect(within(nav()).queryByRole('button', { name: 'Todas as conversas' })).not.toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Contatos' }));
    expect(await screen.findByRole('heading', { name: 'Contatos' })).toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Relatórios' }));
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Configurações' }));
    expect(await screen.findByRole('heading', { name: 'Agentes' })).toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Configurações' }));
    expect(within(nav()).queryByRole('button', { name: 'Webhooks' })).not.toBeInTheDocument();

    FakeEventSource.instances[0].onopen?.();
    FakeEventSource.emit('presence.update', {});
    FakeEventSource.emit('notification.created', { id: 9 });
    expect(await within(nav()).findByText('4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Perfil' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sair' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('hides reports and settings from agents', async () => {
    fakeApi(workspaceRoutes(maria));
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: 'Configurações' })).not.toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: 'Relatórios' })).not.toBeInTheDocument();
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
    await user.click(within(nav()).getByRole('button', { name: /Caixa de entrada/ }));
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
    await user.click(within(nav()).getByRole('button', { name: /Caixa de entrada/ }));
    expect(await screen.findByText('Nenhuma notificação por aqui.')).toBeInTheDocument();
  });
});
