import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentChatScreen } from '../../src/agent/agentChat/AgentChatScreen';
import type { ChatAgent, ChatMessage } from '../../src/agent/agentChat/types';
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

    // The same message on the events stream is not shown twice; the answer ends the wait.
    emit({ event: 'agent_chat.message', data: { ...message(10, 'user', 'O cliente ACME pagou?') } });
    emit({ event: 'agent_chat.message', data: { ...message(11, 'agent', 'Pagou: R$ 1.200,00 em 12/10.') } });
    expect(await within(chat).findByText('Pagou: R$ 1.200,00 em 12/10.')).toBeInTheDocument();
    expect(within(chat).getAllByText('O cliente ACME pagou?')).toHaveLength(1);
    expect(within(chat).queryByRole('status')).not.toBeInTheDocument();
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
});
