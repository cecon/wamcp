import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplyBox } from '../../src/agent/conversations/ReplyBox';
import { MessageItem } from '../../src/agent/conversations/MessageItem';
import { ContactPanel } from '../../src/agent/conversations/ContactPanel';
import { fakeApi, status } from './fake-api';
import { admin, contact, conversation, inbox, labels, maria, message, team } from './fixtures';

const canned = [
  { id: 1, short_code: 'saudacao', content: 'Olá! Como posso ajudar?' },
  { id: 2, short_code: 'prazo', content: 'O prazo é de 3 dias úteis.' },
];

describe('reply box', () => {
  it('sends replies with Enter and private notes from the note tab', async () => {
    const api = fakeApi({
      'POST /conversations/7/messages': (body) =>
        message(9, { ...(body as object), message_type: 'outgoing' }),
    });
    const onSent = vi.fn();
    const user = userEvent.setup();
    render(<ReplyBox path="/conversations/7" disabled={false} onSent={onSent} />);
    const box = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.type(box, 'Oi{Shift>}{Enter}{/Shift}tudo bem?{Enter}');
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(api.called('POST', '/conversations/7/messages')[0].body).toEqual({
      content: 'Oi\ntudo bem?',
      private: false,
    });
    expect(box).toHaveValue('');
    await user.click(screen.getByRole('tab', { name: 'Nota privada' }));
    await user.type(screen.getByRole('textbox', { name: 'Nota privada' }), 'cliente VIP');
    await user.click(screen.getByRole('button', { name: 'Adicionar nota (↵)' }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/messages')[1].body).toEqual({
        content: 'cliente VIP',
        private: true,
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Responder' }));
    expect(screen.getByRole('button', { name: 'Enviar (↵)' })).toBeDisabled();
  });

  it('suggests canned responses after "/" with keyboard and mouse', async () => {
    fakeApi({ 'GET /canned_responses': canned });
    const user = userEvent.setup();
    render(<ReplyBox path="/conversations/7" disabled={false} onSent={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.type(box, '/');
    const list = await screen.findByRole('listbox', { name: 'Respostas prontas' });
    expect(within(list).getByText('/saudacao')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowDown}{Enter}');
    expect(box).toHaveValue('O prazo é de 3 dias úteis.');
    await user.clear(box);
    await user.type(box, '/sau');
    await user.click(await screen.findByText('/saudacao'));
    expect(box).toHaveValue('Olá! Como posso ajudar?');
  });

  it('shows send failures, hides suggestions on errors and blocks resolved conversations', async () => {
    fakeApi({
      'POST /conversations/7/messages': () => {
        throw status(422, 'Sessão desconectada');
      },
      'GET /canned_responses': () => {
        throw status(500, 'x');
      },
    });
    const user = userEvent.setup();
    const { rerender } = render(<ReplyBox path="/conversations/7" disabled={false} onSent={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'teste{Enter}');
    expect(await screen.findByText('Sessão desconectada')).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Mensagem' }));
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), '/x');
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    rerender(<ReplyBox path="/conversations/7" disabled onSent={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Conversa resolvida/)).toBeDisabled();
  });
});

describe('message item', () => {
  it('renders activities, notes, automated, bot and every delivery state', () => {
    render(
      <ul>
        <MessageItem message={message(1, { message_type: 'activity', content: 'Ana resolveu a conversa' })} />
        <MessageItem
          message={message(2, {
            message_type: 'outgoing',
            private: true,
            sender_name: 'Ana',
            content: 'nota',
          })}
        />
        <MessageItem
          message={message(3, {
            message_type: 'outgoing',
            sender_type: 'system',
            sender_name: null,
            status: 'pending',
          })}
        />
        <MessageItem message={message(4, { message_type: 'outgoing', sender_name: 'Ana', status: 'sent' })} />
        <MessageItem
          message={message(5, {
            message_type: 'outgoing',
            sender_type: 'agent_bot',
            sender_name: 'Assistente IA',
            status: 'delivered',
          })}
        />
        <MessageItem message={message(6, { message_type: 'outgoing', sender_name: 'Ana', status: 'read' })} />
        <MessageItem
          message={message(7, {
            message_type: 'outgoing',
            sender_name: 'Ana',
            status: 'failed',
            content_attributes: { external_error: 'Offline' },
          })}
        />
        <MessageItem
          message={message(8, {
            message_type: 'outgoing',
            sender_type: 'system',
            sender_name: null,
            status: 'failed',
            content_attributes: { automated: 'Saudação' },
          })}
        />
        <MessageItem
          message={message(9, { message_type: 'outgoing', sender_type: null, sender_name: null })}
        />
        <MessageItem message={message(10)} />
      </ul>,
    );
    expect(screen.getByText('Ana resolveu a conversa')).toBeInTheDocument();
    expect(screen.getByText(/nota privada/)).toBeInTheDocument();
    expect(screen.getByText('Pelo celular')).toBeInTheDocument();
    expect(screen.getByText('Saudação')).toBeInTheDocument();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    for (const label of ['Enviando', 'Entregue', 'Lida'])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getAllByLabelText('Enviada')).toHaveLength(2);
    expect(screen.getByTitle('Offline')).toHaveTextContent('não enviada');
    expect(screen.getByTitle('Falha no envio')).toBeInTheDocument();
  });
});

describe('contact panel', () => {
  const catalog = {
    inboxes: [inbox],
    agents: [
      admin,
      { ...maria, inbox_ids: [10] },
      { ...maria, id: 3, name: 'Off', availability: 'offline' as const, inbox_ids: [10] },
    ],
    teams: [team],
    labels,
  };
  function renderPanel(extra: Partial<typeof conversation> = {}) {
    const onChange = vi.fn(),
      onError = vi.fn(),
      onOpen = vi.fn(),
      onClose = vi.fn();
    render(
      <ContactPanel
        conversation={{ ...conversation, ...extra }}
        user={admin}
        catalog={catalog}
        onChange={onChange}
        onError={onError}
        onOpenConversation={onOpen}
        onClose={onClose}
      />,
    );
    return { onChange, onError, onOpen, onClose };
  }

  it('assigns agent, team and priority, edits labels and opens previous conversations', async () => {
    const api = fakeApi({
      'GET /contacts/50': contact,
      'POST /conversations/7/assignments': (body) => {
        if ((body as { team_id?: number }).team_id === 5) throw status(422, 'Time sem permissão');
        return { ...conversation, ...(body as object) };
      },
      'POST /conversations/7/toggle_priority': (body) => ({ ...conversation, ...(body as object) }),
      'POST /conversations/7/labels': (body) => ({
        ...conversation,
        labels: (body as { labels: string[] }).labels,
      }),
    });
    const user = userEvent.setup();
    const { onChange, onError, onOpen } = renderPanel();
    expect(await screen.findByText('joao@example.com')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agente atribuído' }), '2');
    await user.click(screen.getByRole('button', { name: 'Atribuir a mim' }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/assignments').map((c) => c.body)).toEqual([
        { assignee_id: 2 },
        { assignee_id: 1 },
      ]),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time atribuído' }), '5');
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Time sem permissão'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Prioridade' }), 'urgent');
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/toggle_priority')[0].body).toEqual({ priority: 'urgent' }),
    );
    await user.click(screen.getByRole('button', { name: /Adicionar etiquetas/ }));
    await user.click(screen.getByRole('menuitem', { name: 'financeiro' }));
    await user.click(screen.getByRole('button', { name: 'Remover vip' }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/labels').map((c) => c.body)).toEqual([
        { labels: ['vip', 'financeiro'] },
        { labels: [] },
      ]),
    );
    expect(onChange).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Informações da conversa' }));
    expect(screen.getByText('#7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conversas anteriores' }));
    await user.click(screen.getByRole('button', { name: /#3/ }));
    expect(onOpen).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole('button', { name: 'Ações da conversa' }));
    expect(screen.queryByRole('combobox', { name: 'Prioridade' })).not.toBeInTheDocument();
  });

  it('handles contacts without history and with every label already applied', async () => {
    fakeApi({
      'GET /contacts/50': () => {
        throw status(404, 'x');
      },
    });
    const user = userEvent.setup();
    const { onClose } = renderPanel({ labels: ['vip', 'financeiro'], assignee_id: 1 });
    expect(screen.queryByRole('button', { name: 'Atribuir a mim' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Adicionar etiquetas/ }));
    expect(screen.getByText('Nenhuma etiqueta disponível.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conversas anteriores' }));
    expect(screen.getByText('Nenhuma conversa anterior.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
