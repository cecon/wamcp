import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationsScreen } from '../../src/agent/conversations/ConversationsScreen';
import { connectRealtime } from '../../src/agent/api';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, conversation, inbox, labels, maria, message, team, workspaceRoutes } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

function renderScreen(route: Record<string, unknown> = {}) {
  const onNavigate = vi.fn();
  const realtime = connectRealtime(() => {});
  const view = render(
    <ConversationsScreen
      route={{ page: 'conversations', ...route }}
      user={admin}
      catalog={catalog}
      realtime={realtime}
      onNavigate={onNavigate}
    />,
  );
  return { onNavigate, view };
}

describe('chat list', () => {
  it('switches tabs and status, shows cards and refreshes on realtime events', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations': [
        { ...conversation, priority: 'urgent', assignee_name: 'Maria Souza', unread_count: 12 },
        {
          ...conversation,
          id: 2,
          display_id: 8,
          contact_name: null,
          contact_phone: null,
          labels: ['sem-cor'],
          priority: 'low',
          unread_count: 0,
          last_message: null,
        },
        { ...conversation, id: 3, display_id: 9, priority: 'high' },
        { ...conversation, id: 4, display_id: 10, priority: 'medium' },
      ],
    });
    const user = userEvent.setup();
    const { onNavigate } = renderScreen();
    expect(await screen.findAllByText('João Cliente')).toHaveLength(3);
    expect(screen.getByText('9+')).toBeInTheDocument();
    expect(screen.getByLabelText('Prioridade urgente')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Não atribuídas\s*4/ })).toBeInTheDocument();
    expect(api.calls[0].search).toContain('assignee_type=me');
    await user.click(screen.getByRole('tab', { name: /Todas/ }));
    await user.click(screen.getByRole('button', { name: 'Filtrar por status' }));
    await user.selectOptions(screen.getByRole('combobox'), 'resolved');
    await waitFor(() => {
      const last = api.called('GET', '/conversations').at(-1)!.search;
      expect(last).toContain('assignee_type=all');
      expect(last).toContain('status=resolved');
    });
    expect(screen.getByText('Resolvidas')).toBeInTheDocument();
    const before = api.called('GET', '/conversations').length;
    FakeEventSource.emit('message.created', { conversation_id: 100 });
    FakeEventSource.emit('presence.update', {});
    await waitFor(() => expect(api.called('GET', '/conversations').length).toBe(before + 1));
    await user.click(screen.getAllByText('João Cliente')[0]);
    expect(onNavigate).toHaveBeenCalledWith({ page: 'conversations', displayId: 7 });
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();
  });

  it('paginates, reports errors and shows the empty state', async () => {
    const page = Array.from({ length: 25 }, (_, i) => ({ ...conversation, id: i + 1, display_id: i + 1 }));
    const api = fakeApi({ ...workspaceRoutes(), 'GET /conversations': page });
    const user = userEvent.setup();
    renderScreen({ teamId: 5 });
    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(api.called('GET', '/conversations').at(-1)!.search).toContain('page=2'));
    api.route('GET /conversations', () => {
      throw status(500, 'Falhou geral');
    });
    await user.click(screen.getByRole('tab', { name: /Todas/ }));
    expect(await screen.findByText('Falhou geral')).toBeInTheDocument();
    api.route('GET /conversations', []);
    await user.click(screen.getByRole('tab', { name: /Minhas/ }));
    expect(await screen.findByText('Não há conversas ativas neste grupo.')).toBeInTheDocument();
  });

  it('titles the list by inbox, label and search scope', async () => {
    fakeApi(workspaceRoutes());
    const { view } = renderScreen({ inboxId: 10 });
    expect(await screen.findByRole('heading', { name: 'Suporte' })).toBeInTheDocument();
    view.rerender(
      <ConversationsScreen
        route={{ page: 'conversations', inboxId: 999 }}
        user={admin}
        catalog={catalog}
        realtime={connectRealtime(() => {})}
        onNavigate={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Caixa de entrada' })).toBeInTheDocument();
    view.rerender(
      <ConversationsScreen
        route={{ page: 'conversations', teamId: 999 }}
        user={admin}
        catalog={catalog}
        realtime={connectRealtime(() => {})}
        onNavigate={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Time' })).toBeInTheDocument();
  });
});

describe('conversation box', () => {
  it('shows messages, live updates and the resolve split button', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'POST /conversations/7/toggle_status': (body) => ({ ...conversation, ...(body as object) }),
    });
    const user = userEvent.setup();
    const { onNavigate } = renderScreen({ displayId: 7 });
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    await waitFor(() => expect(api.called('POST', '/conversations/7/update_last_seen').length).toBe(1));
    FakeEventSource.emit('message.created', message(3, { content: 'Ao vivo' }));
    expect(await screen.findByText('Ao vivo')).toBeInTheDocument();
    FakeEventSource.emit('message.updated', message(3, { content: 'Editada' }));
    expect(await screen.findByText('Editada')).toBeInTheDocument();
    FakeEventSource.emit('message.created', message(4, { conversation_id: 999, content: 'Outra' }));
    expect(screen.queryByText('Outra')).not.toBeInTheDocument();
    FakeEventSource.emit('assignee.changed', {
      ...conversation,
      assignee_id: 2,
      assignee_name: 'Maria Souza',
    });
    expect(await screen.findByRole('combobox', { name: 'Agente atribuído' })).toHaveValue('2');

    const box = screen.getByRole('region', { name: 'Conversa' });
    await user.click(within(box).getByRole('button', { name: 'Mais ações de status' }));
    await user.click(screen.getByRole('menuitem', { name: 'Adiar por 1 hora' }));
    expect(await within(box).findByText(/adiada até/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Reabrir' }));
    await user.click(within(box).getByRole('button', { name: 'Mais ações de status' }));
    await user.click(screen.getByRole('menuitem', { name: 'Marcar como pendente' }));
    expect(await within(box).findByText(/com a IA/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Abrir' }));
    await user.click(await within(box).findByRole('button', { name: 'Resolver' }));
    const sent = api
      .called('POST', '/conversations/7/toggle_status')
      .map((c) => (c.body as { status: string }).status);
    expect(sent).toEqual(['snoozed', 'open', 'pending', 'open', 'resolved']);
    expect(await screen.findByPlaceholderText(/Conversa resolvida/)).toBeDisabled();

    await user.click(within(box).getByRole('button', { name: 'Ocultar painel do contato' }));
    expect(screen.queryByRole('complementary', { name: 'Painel do contato' })).not.toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Mostrar painel do contato' }));
    await user.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(screen.queryByRole('complementary', { name: 'Painel do contato' })).not.toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Voltar' }));
    expect(onNavigate).toHaveBeenCalledWith({ page: 'conversations', displayId: undefined });
  });

  it('loads older messages and WhatsApp history, and reports load errors', async () => {
    const full = Array.from({ length: 50 }, (_, i) => message(i + 10));
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations/7/messages': (_b: unknown, url: URL) =>
        url.searchParams.get('before') ? [message(1, { content: 'Bem antiga' })] : full,
      'GET /conversations/7/history': [
        { id: 'H1', body: 'Conversa de 2025', from_me: 0, ts: 1700000000 },
        { id: 'H2', body: 'Resposta', from_me: 1, ts: 1700000100 },
      ],
    });
    const user = userEvent.setup();
    renderScreen({ displayId: 7 });
    await user.click(await screen.findByRole('button', { name: 'Mensagens anteriores' }));
    expect(await screen.findByText('Bem antiga')).toBeInTheDocument();
    expect(api.called('GET', '/conversations/7/messages').at(-1)!.search).toBe('?before=10');
    await user.click(screen.getByRole('button', { name: /Histórico do WhatsApp/ }));
    expect(await screen.findByText('Conversa de 2025')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Histórico do WhatsApp/ }));
    await waitFor(() =>
      expect(api.called('GET', '/conversations/7/history').at(-1)!.search).toContain('before_id=H1'),
    );
    api.route('GET /conversations/7/history', () => {
      throw status(500, 'Histórico indisponível');
    });
    await user.click(screen.getByRole('button', { name: /Histórico do WhatsApp/ }));
    expect(await screen.findByText('Histórico indisponível')).toBeInTheDocument();
  });

  it('shows an error when the conversation cannot be loaded', async () => {
    fakeApi({
      ...workspaceRoutes(),
      'GET /conversations/7': () => {
        throw status(404, 'Conversa não encontrada');
      },
    });
    renderScreen({ displayId: 7 });
    expect(await screen.findByText('Conversa não encontrada')).toBeInTheDocument();
  });

  it('shows the empty WhatsApp history', async () => {
    fakeApi({ ...workspaceRoutes(), 'GET /conversations/7/history': [] });
    const user = userEvent.setup();
    renderScreen({ displayId: 7 });
    await user.click(await screen.findByRole('button', { name: /Histórico do WhatsApp/ }));
    expect(await screen.findByText('Sem histórico anterior sincronizado.')).toBeInTheDocument();
  });
});
