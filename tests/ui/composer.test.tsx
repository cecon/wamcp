import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../../src/agent/inbox/Composer';
import { MessageBubble } from '../../src/agent/inbox/MessageBubble';
import { fakeApi, status } from './fake-api';
import { message } from './fixtures';

const canned = [
  { id: 1, short_code: 'saudacao', content: 'Olá! Como posso ajudar?' },
  { id: 2, short_code: 'prazo', content: 'O prazo é de 3 dias úteis.' },
];

describe('composer', () => {
  it('sends replies with Enter and private notes from the note tab', async () => {
    const api = fakeApi({
      'POST /conversations/7/messages': (body) =>
        message(9, { ...(body as object), message_type: 'outgoing' }),
    });
    const onSent = vi.fn();
    const user = userEvent.setup();
    render(<Composer path="/conversations/7" disabled={false} onSent={onSent} />);
    const box = screen.getByPlaceholderText(/Digite a mensagem/);
    await user.type(box, 'Oi{Shift>}{Enter}{/Shift}tudo bem?{Enter}');
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(api.called('POST', '/conversations/7/messages')[0].body).toEqual({
      content: 'Oi\ntudo bem?',
      private: false,
    });
    expect(box).toHaveValue('');

    await user.click(screen.getByRole('button', { name: /Nota interna/ }));
    await user.type(screen.getByPlaceholderText(/Nota visível/), 'cliente VIP');
    await user.click(screen.getByRole('button', { name: /Salvar nota/ }));
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/messages')[1].body).toEqual({
        content: 'cliente VIP',
        private: true,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Responder' }));
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeDisabled();
  });

  it('suggests canned responses after "/" with keyboard and mouse selection', async () => {
    fakeApi({ 'GET /canned_responses': canned });
    const user = userEvent.setup();
    render(<Composer path="/conversations/7" disabled={false} onSent={vi.fn()} />);
    const box = screen.getByPlaceholderText(/Digite a mensagem/);
    await user.type(box, '/');
    expect(await screen.findByText('/saudacao')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('O prazo é de 3 dias úteis.');

    await user.clear(box);
    await user.type(box, '/sau');
    await user.click(await screen.findByText('/saudacao'));
    expect(box).toHaveValue('Olá! Como posso ajudar?');
  });

  it('shows send failures and blocks replies on resolved conversations', async () => {
    fakeApi({
      'POST /conversations/7/messages': () => {
        throw status(422, 'Sessão desconectada');
      },
      'GET /canned_responses': () => {
        throw status(500, 'x');
      },
    });
    const user = userEvent.setup();
    const { rerender } = render(<Composer path="/conversations/7" disabled={false} onSent={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Digite a mensagem/), 'teste{Enter}');
    expect(await screen.findByText('Sessão desconectada')).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(/Digite a mensagem/));
    await user.type(screen.getByPlaceholderText(/Digite a mensagem/), '/x');
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    rerender(<Composer path="/conversations/7" disabled onSent={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Conversa resolvida/)).toBeDisabled();
  });
});

describe('message bubble', () => {
  it('renders activities, notes and every delivery state', () => {
    const { container } = render(
      <>
        <MessageBubble
          message={message(1, { message_type: 'activity', content: 'Ana resolveu a conversa' })}
        />
        <MessageBubble
          message={message(2, {
            message_type: 'outgoing',
            private: true,
            sender_name: 'Ana',
            content: 'nota',
          })}
        />
        <MessageBubble
          message={message(3, {
            message_type: 'outgoing',
            sender_type: 'system',
            sender_name: null,
            status: 'pending',
          })}
        />
        <MessageBubble
          message={message(4, { message_type: 'outgoing', sender_name: 'Ana', status: 'sent' })}
        />
        <MessageBubble
          message={message(5, { message_type: 'outgoing', sender_name: 'Ana', status: 'delivered' })}
        />
        <MessageBubble
          message={message(6, { message_type: 'outgoing', sender_name: 'Ana', status: 'read' })}
        />
        <MessageBubble
          message={message(7, {
            message_type: 'outgoing',
            sender_name: 'Ana',
            status: 'failed',
            content_attributes: { external_error: 'Offline' },
          })}
        />
        <MessageBubble
          message={message(8, { message_type: 'outgoing', sender_name: 'Ana', status: 'failed' })}
        />
        <MessageBubble message={message(9)} />
      </>,
    );
    expect(screen.getByText('Ana resolveu a conversa')).toBeInTheDocument();
    expect(screen.getByText(/nota interna/)).toBeInTheDocument();
    expect(screen.getByText('Pelo celular')).toBeInTheDocument();
    for (const label of ['Enviando', 'Enviada', 'Entregue', 'Lida'])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toHaveTextContent('não enviada');
    expect(screen.getByTitle('Falha no envio')).toBeInTheDocument();
    expect(container.querySelectorAll('.bubble.in')).toHaveLength(1);
  });
});
