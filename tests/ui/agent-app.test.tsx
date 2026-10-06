import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, maria, workspaceRoutes } from './fixtures';

describe('login', () => {
  it('shows the login form, reports bad credentials and enters the workspace', async () => {
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
      'PATCH /profile': admin,
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
    // State-changing calls carry the CSRF token returned by the login.
    await user.click(screen.getByRole('button', { name: 'Online' }));
    await waitFor(() => expect(api.called('PATCH', '/profile')).toHaveLength(1));
    expect(api.called('PATCH', '/profile')[0].headers['X-CSRF-Token']).toBe('csrf-1');
  });
});

describe('workspace', () => {
  it('navigates between pages, changes availability and logs out', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'PATCH /profile': (body) => ({ ...admin, ...(body as object) }),
      'POST /auth/logout': { ok: true },
      'GET /contacts': [],
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(await screen.findByText('3')).toBeInTheDocument(); // unread notifications badge

    await user.click(screen.getByRole('button', { name: 'Contatos' }));
    expect(await screen.findByRole('heading', { name: 'Contatos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    expect(await screen.findByRole('heading', { name: 'Configurações' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ocupado' }));
    await waitFor(() => expect(api.called('PATCH', '/profile')[0].body).toEqual({ availability: 'busy' }));

    FakeEventSource.instances[0].onopen?.();
    await user.click(screen.getByRole('button', { name: /Sair/ }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('hides settings from agents', async () => {
    fakeApi(workspaceRoutes(maria));
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurações' })).not.toBeInTheDocument();
  });

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
        contact_name: 'João',
        actor_name: null,
        read_at: 5,
        created_at: 2,
      },
      {
        id: 3,
        notification_type: 'conversation_creation',
        display_id: 8,
        contact_name: null,
        actor_name: null,
        read_at: 5,
        created_at: 3,
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
    await user.click(await screen.findByRole('button', { name: 'Notificações' }));
    const panel = await screen.findByRole('region', { name: 'Notificações' });
    expect(await within(panel).findByText('Ana atribuiu a você a conversa #7')).toBeInTheDocument();
    expect(within(panel).getByText('Nova mensagem de João em #7')).toBeInTheDocument();
    expect(within(panel).getByText('Nova conversa #8 de contato')).toBeInTheDocument();

    FakeEventSource.emit('notification.created', { id: 4, user_id: 1 });
    await waitFor(() => expect(api.called('GET', '/notifications').length).toBeGreaterThan(1));
    await user.click(within(panel).getByRole('button', { name: /Ler todas/ }));
    await waitFor(() => expect(api.called('POST', '/notifications/read_all')).toHaveLength(1));

    await user.click(within(panel).getByText('Ana atribuiu a você a conversa #7'));
    await waitFor(() => expect(api.called('PATCH', '/notifications/1')).toHaveLength(1));
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Notificações' })).not.toBeInTheDocument();
  });

  it('closes the notification panel', async () => {
    fakeApi({ ...workspaceRoutes(), 'GET /notifications': { items: [], unread: 0 } });
    const user = userEvent.setup();
    render(<AgentApp />);
    await user.click(await screen.findByRole('button', { name: 'Notificações' }));
    expect(await screen.findByText('Nenhuma notificação.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText('Nenhuma notificação.')).not.toBeInTheDocument();
  });
});
