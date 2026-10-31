import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentChatScreen } from '../../src/agent/agentChat/AgentChatScreen';
import type { ChatAgent, ChatMessage, ChatSession } from '../../src/agent/agentChat/types';
import type { RealtimeEvent } from '../../src/agent/api';
import { fakeApi } from './fake-api';

const message = (id: number, role: ChatMessage['role'], content: string): ChatMessage => ({
  id,
  chat_id: 1,
  user_id: 1,
  agent_id: 3,
  role,
  content,
  created_at: Date.now(),
  session: 1,
});
const agent = (id: number, name: string, extra: Partial<ChatAgent> = {}): ChatAgent => ({
  id,
  name,
  description: null,
  role: 'operator',
  profile_name: 'Financeiro',
  runtime: 'claude_cli',
  model: 'sonnet',
  system: false,
  last: null,
  ...extra,
});

function fakeRealtime() {
  let emit: (e: RealtimeEvent) => void = () => {};
  return {
    realtime: {
      subscribe: (listener: (e: RealtimeEvent) => void) => {
        emit = listener;
        return () => {};
      },
      close: () => {},
    },
    emit: (e: RealtimeEvent) => act(() => emit(e)),
  };
}

describe('chats with AI agents', () => {
  it('lists the agents and opens a chat', async () => {
    fakeApi({
      'GET /agent_chats': [
        agent(9, 'Sistema', {
          system: true,
          last: { ...message(4, 'agent', 'Proposta 1. Aprova?'), agent_id: 9 },
        }),
        agent(3, 'Anny'),
      ],
    });
    const onSelect = vi.fn();
    render(<AgentChatScreen onSelect={onSelect} />);
    expect(await screen.findByText('Sistema · Proposta 1. Aprova?')).toBeInTheDocument();
    expect(screen.getByText('Comece uma conversa')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Anny/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('sends a message, waits for the answer and shows it when it arrives', async () => {
    const api = fakeApi({
      'GET /agent_chats': [agent(3, 'Anny')],
      'GET /agent_chats/3/messages': [],
      'POST /agent_chats/3/messages': (body) => message(10, 'user', (body as { content: string }).content),
    });
    const { realtime, emit } = fakeRealtime();
    render(<AgentChatScreen agentId={3} realtime={realtime} onSelect={vi.fn()} />);
    const chat = await screen.findByRole('region', { name: 'Conversa com Anny' });
    expect(within(chat).getByText(/ninguém mais da equipe vê/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(within(chat).getByLabelText('Mensagem para Anny'), 'O cliente ACME pagou?{Enter}');
    await waitFor(() => expect(api.called('POST', '/agent_chats/3/messages')).toHaveLength(1));
    expect(api.called('POST', '/agent_chats/3/messages')[0].body).toEqual({
      content: 'O cliente ACME pagou?',
    });
    expect(await within(chat).findByText('O cliente ACME pagou?')).toBeInTheDocument();
    expect(within(chat).getByRole('status')).toHaveTextContent('Anny está pensando…');

    // What the agent does shows up while it works (another agent's steps do not).
    const step = (agentId: number, kind: string, text: string) =>
      emit({ event: 'agent_chat.progress', data: { agent_id: agentId, chat_id: 1, step: { kind, text } } });
    step(3, 'note', 'Vou procurar o boleto da ACME.');
    step(3, 'tool', 'list_conversations');
    step(4, 'note', 'Outra conversa.');
    const doing = within(chat).getByRole('list', { name: 'O que Anny está fazendo' });
    expect(
      within(doing)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Vou procurar o boleto da ACME.', 'Usando list_conversations']);

    // The same message on the events stream is not shown twice; the answer ends the wait.
    emit({ event: 'agent_chat.message', data: { ...message(10, 'user', 'O cliente ACME pagou?') } });
    emit({ event: 'agent_chat.message', data: { ...message(11, 'agent', 'Pagou: R$ 1.200,00 em 12/10.') } });
    expect(await within(chat).findByText('Pagou: R$ 1.200,00 em 12/10.')).toBeInTheDocument();
    expect(within(chat).getAllByText('O cliente ACME pagou?')).toHaveLength(1);
    expect(within(chat).queryByRole('status')).not.toBeInTheDocument();
    expect(within(chat).queryByText('Vou procurar o boleto da ACME.')).not.toBeInTheDocument();
  });

  it('shows why the agent could not answer', async () => {
    fakeApi({
      'GET /agent_chats': [agent(3, 'Anny')],
      'GET /agent_chats/3/messages': [
        message(1, 'user', 'Oi'),
        message(2, 'error', 'Não consegui responder: Claude Code não encontrado.'),
      ],
    });
    render(<AgentChatScreen agentId={3} onSelect={vi.fn()} />);
    expect(await screen.findByText('Sem resposta')).toBeInTheDocument();
    expect(screen.getByText('Não consegui responder: Claude Code não encontrado.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  const session = (number: number, extra: Partial<ChatSession> = {}): ChatSession => ({
    number,
    started_at: Date.now(),
    last_at: Date.now(),
    messages: 2,
    preview: `Pergunta ${number}`,
    tokens: 12_300,
    cost_brl: 0.08,
    full: false,
    ...extra,
  });

  it('shows the agent answer as Markdown and what the conversation spent', async () => {
    fakeApi({
      'GET /agent_chats': [
        agent(3, 'Anny', { last: message(2, 'agent', '**Pago:** ver o [boleto](https://example.com/b)') }),
      ],
      'GET /agent_chats/3/sessions': { current: 1, token_limit: 500_000, sessions: [session(1)] },
      'GET /agent_chats/3/messages': [
        message(1, 'user', 'Resumo?'),
        message(
          2,
          'agent',
          ['**Pago:**', '', '- ACME', '- [boleto](https://example.com/b)', '', '<script>x</script>'].join(
            '\n',
          ),
        ),
      ],
    });
    render(<AgentChatScreen agentId={3} onSelect={vi.fn()} />);
    const chat = await screen.findByRole('region', { name: 'Conversa com Anny' });
    expect((await within(chat).findByText('Pago:')).tagName).toBe('STRONG');
    expect(
      within(within(chat).getByText('ACME').closest('ul')!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['ACME', 'boleto']);
    expect(within(chat).getByRole('link', { name: 'boleto' })).toHaveAttribute(
      'href',
      'https://example.com/b',
    );
    expect(chat.querySelector('script')).toBeNull();
    expect(await within(chat).findByText(/12,3 mil de 500 mil tokens/)).toBeInTheDocument();
    expect(screen.getByText('Pago: ver o boleto')).toBeInTheDocument();
  });

  it('starts a new conversation and reads an earlier one without answering it', async () => {
    let current = 1;
    const api = fakeApi({
      'GET /agent_chats': [agent(3, 'Anny')],
      'GET /agent_chats/3/sessions': () => ({
        current,
        token_limit: 500_000,
        sessions:
          current === 1 ? [session(1)] : [session(2, { messages: 0, preview: null, tokens: 0 }), session(1)],
      }),
      'POST /agent_chats/3/sessions': () => {
        current = 2;
        return { current, token_limit: 500_000, sessions: [] };
      },
      'GET /agent_chats/3/messages': (_, url) =>
        url.searchParams.get('session') === '2'
          ? []
          : [message(1, 'user', 'Pergunta 1'), message(2, 'agent', 'Resposta 1')],
    });
    render(<AgentChatScreen agentId={3} onSelect={vi.fn()} />);
    const chat = await screen.findByRole('region', { name: 'Conversa com Anny' });
    expect(await within(chat).findByText('Resposta 1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(chat).getByRole('button', { name: 'Nova conversa' }));
    await waitFor(() => expect(api.called('POST', '/agent_chats/3/sessions')).toHaveLength(1));
    await waitFor(() => expect(within(chat).queryByText('Resposta 1')).not.toBeInTheDocument());
    expect(within(chat).getByLabelText('Mensagem para Anny')).toBeVisible();

    await user.click(within(chat).getByRole('button', { name: 'Conversas anteriores' }));
    await user.click(within(chat).getByRole('menuitem', { name: /Pergunta 1/ }));
    expect(await within(chat).findByText('Resposta 1')).toBeInTheDocument();
    expect(within(chat).getByText(/foi encerrada/)).toBeInTheDocument();
    expect(within(chat).queryByLabelText('Mensagem para Anny')).not.toBeVisible();
    await user.click(within(chat).getByRole('button', { name: 'Voltar para a conversa atual' }));
    await waitFor(() => expect(within(chat).queryByText('Resposta 1')).not.toBeInTheDocument());
  });

  it('asks for a new conversation when the open one is out of tokens', async () => {
    fakeApi({
      'GET /agent_chats': [agent(3, 'Anny')],
      'GET /agent_chats/3/sessions': {
        current: 1,
        token_limit: 500_000,
        sessions: [session(1, { tokens: 510_000, full: true })],
      },
      'GET /agent_chats/3/messages': [message(1, 'user', 'Oi'), message(2, 'agent', 'Olá')],
    });
    render(<AgentChatScreen agentId={3} onSelect={vi.fn()} />);
    const chat = await screen.findByRole('region', { name: 'Conversa com Anny' });
    expect(await within(chat).findByText(/chegou ao limite de tokens/)).toBeInTheDocument();
    expect(within(chat).getByLabelText('Mensagem para Anny')).toBeDisabled();
  });
});
