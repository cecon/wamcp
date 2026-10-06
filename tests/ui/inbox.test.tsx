import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from '../../src/agent/inbox/Inbox';
import { connectRealtime } from '../../src/agent/api';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, conversation, inbox, labels, maria, message, team, workspaceRoutes } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

function renderInbox(selected: number | null = null) {
  const onSelect = vi.fn();
  const realtime = connectRealtime(() => {});
  const view = render(
    <Inbox user={admin} catalog={catalog} realtime={realtime} selected={selected} onSelect={onSelect} />,
  );
  return { onSelect, view, realtime };
}

describe('conversation list', () => {
  it('loads tabs and filters and refreshes on realtime events', async () => {
    const api = fakeApi(workspaceRoutes());
    const user = userEvent.setup();
    const { onSelect } = renderInbox();
    expect(await screen.findByText('João Cliente')).toBeInTheDocument();
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Não atribuídas\s*4/ })).toBeInTheDocument();
    expect(api.calls[0].search).toContain('assignee_type=me');

    await user.click(screen.getByRole('tab', { name: /Todas/ }));
    await user.selectOptions(screen.getByLabelText('Status'), 'pending');
    await user.selectOptions(screen.getByLabelText('Caixa de entrada'), '10');
    await user.selectOptions(screen.getByLabelText('Etiqueta'), 'vip');
    await user.type(screen.getByPlaceholderText('Buscar por nome ou telefone'), 'joão');
    await waitFor(() => {
      const last = api.called('GET', '/conversations').at(-1)!.search;
      expect(last).toContain('assignee_type=all');
      expect(last).toContain('status=pending');
      expect(last).toContain('inbox_id=10');
      expect(last).toContain('label=vip');
      expect(decodeURIComponent(last)).toContain('q=joão');
    });

    const before = api.called('GET', '/conversations').length;
    FakeEventSource.emit('message.created', { conversation_id: 100 });
    FakeEventSource.emit('presence.update', {});
    await waitFor(() => expect(api.called('GET', '/conversations').length).toBe(before + 1));

    await user.click(screen.getByText('João Cliente'));
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it('paginates and reports load errors', async () => {
    const page = Array.from({ length: 25 }, (_, i) => ({ ...conversation, id: i + 1, display_id: i + 1 }));
    const api = fakeApi({ ...workspaceRoutes(), 'GET /conversations': page });
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(api.called('GET', '/conversations').at(-1)!.search).toContain('page=2'));

    api.route('GET /conversations', () => {
      throw status(500, 'Falhou geral');
    });
    await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
    expect(await screen.findByText('Falhou geral')).toBeInTheDocument();
  });
});

describe('conversation view', () => {
  it('shows messages, receives realtime updates and changes status', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'POST /conversations/7/toggle_status': (body) => ({ ...conversation, ...(body as object) }),
    });
    const user = userEvent.setup();
    renderInbox(7);
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    await waitFor(() => expect(api.called('POST', '/conversations/7/update_last_seen').length).toBe(1));

    FakeEventSource.emit('message.created', message(3, { content: 'Mensagem ao vivo' }));
    expect(await screen.findByText('Mensagem ao vivo')).toBeInTheDocument();
    FakeEventSource.emit('message.updated', message(3, { content: 'Mensagem editada' }));
    expect(await screen.findByText('Mensagem editada')).toBeInTheDocument();
    FakeEventSource.emit('message.created', message(4, { conversation_id: 999, content: 'Outra conversa' }));
    expect(screen.queryByText('Outra conversa')).not.toBeInTheDocument();
    FakeEventSource.emit('assignee.changed', {
      ...conversation,
      assignee_id: 2,
      assignee_name: 'Maria Souza',
    });
    expect(await screen.findByDisplayValue(/Maria Souza/)).toBeInTheDocument();

    await user.click(screen.getByTitle('Adiar por 1 hora'));
    expect(await screen.findByRole('button', { name: /Reabrir/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reabrir/ }));
    await user.click(await screen.findByTitle('Adiar até amanhã'));
    await user.click(await screen.findByRole('button', { name: /Reabrir/ }));
    await user.click(await screen.findByRole('button', { name: /Resolver/ }));
    const bodies = api
      .called('POST', '/conversations/7/toggle_status')
      .map((c) => c.body as { status: string });
    expect(bodies.map((b) => b.status)).toEqual(['snoozed', 'open', 'snoozed', 'open', 'resolved']);
    expect(await screen.findByPlaceholderText(/Conversa resolvida/)).toBeDisabled();
  });

  it('offers to take pending conversations from the AI and loads older messages and history', async () => {
    const full = Array.from({ length: 50 }, (_, i) => message(i + 10));
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations/7': { ...conversation, status: 'pending' },
      'GET /conversations/7/messages': (_body: unknown, url: URL) =>
        url.searchParams.get('before') ? [message(1, { content: 'Bem antiga' })] : full,
      'GET /conversations/7/history': [
        { id: 'H1', body: 'Conversa de 2025', from_me: 0, ts: 1700000000 },
        { id: 'H2', body: 'Resposta antiga', from_me: 1, ts: 1700000100 },
      ],
      'POST /conversations/7/toggle_status': { ...conversation, status: 'open' },
    });
    const user = userEvent.setup();
    renderInbox(7);
    expect(await screen.findByText('com a IA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Assumir da IA/ }));
    expect(await screen.findByRole('button', { name: /Resolver/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mensagens anteriores' }));
    expect(await screen.findByText('Bem antiga')).toBeInTheDocument();
    expect(api.called('GET', '/conversations/7/messages').at(-1)!.search).toBe('?before=10');
    await user.click(screen.getByRole('button', { name: /Histórico do WhatsApp/ }));
    expect(await screen.findByText('Conversa de 2025')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Histórico do WhatsApp/ }));
    await waitFor(() =>
      expect(api.called('GET', '/conversations/7/history').at(-1)!.search).toContain('before_id=H1'),
    );
  });

  it('shows errors for missing conversations and failed actions', async () => {
    fakeApi({
      ...workspaceRoutes(),
      'GET /conversations/7': () => {
        throw status(404, 'Conversa não encontrada');
      },
    });
    renderInbox(7);
    expect(await screen.findByText('Conversa não encontrada')).toBeInTheDocument();
  });
});

describe('details panel', () => {
  it('assigns agents and teams, takes the conversation and toggles labels', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations/7/history': [],
      'POST /conversations/7/assignments': (body) => {
        const b = body as { assignee_id?: number; team_id?: number };
        if (b.team_id === 5) throw status(422, 'Time sem permissão');
        return { ...conversation, ...b };
      },
      'POST /conversations/7/labels': (body) => ({
        ...conversation,
        labels: (body as { labels: string[] }).labels,
      }),
    });
    const user = userEvent.setup();
    renderInbox(7);
    const panel = (await screen.findByText('Responsável')).closest('aside')!;
    expect(within(panel).getByText('+5511988887777')).toBeInTheDocument();

    await user.selectOptions(within(panel).getByRole('combobox', { name: /Responsável/ }), '2');
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/assignments')[0].body).toEqual({ assignee_id: 2 }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Assumir conversa' }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/assignments')[1].body).toEqual({ assignee_id: 1 }),
    );
    expect(within(panel).queryByRole('button', { name: 'Assumir conversa' })).not.toBeInTheDocument();

    await user.selectOptions(within(panel).getByRole('combobox', { name: /Time/ }), '5');
    expect(await screen.findByText('Time sem permissão')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'financeiro' }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/labels')[0].body).toEqual({
        labels: ['vip', 'financeiro'],
      }),
    );
    await user.click(within(panel).getByRole('button', { name: 'vip' }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/labels')[1].body).toEqual({ labels: ['financeiro'] }),
    );
    await user.click(screen.getByRole('button', { name: /Histórico do WhatsApp/ }));
    expect(await screen.findByText('Sem histórico anterior sincronizado.')).toBeInTheDocument();
  });
});
