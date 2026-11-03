import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as chatUi from '@c3theme/chat';

import { AgentChatScreen } from '../../src/agent/agentChat/AgentChatScreen';
import type { ChatAgent, ChatMessage } from '../../src/agent/agentChat/types';
import type { Realtime, RealtimeEvent } from '../../src/agent/api';
import { fakeApi } from './fake-api';

/** O `AssistantPanel` só existe no `@c3theme/chat` 0.3+; na árvore antiga os testes são pulados. */
const assistantDisponivel = Boolean((chatUi as unknown as { AssistantPanel?: unknown }).AssistantPanel);
const describeC3 = assistantDisponivel ? describe : describe.skip;

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
const agent = (id: number, name: string): ChatAgent => ({
  id,
  name,
  description: null,
  role: 'operator',
  profile_name: 'Financeiro',
  runtime: 'claude_cli',
  model: 'sonnet',
  system: false,
  last: null,
});
const session = (number: number) => ({
  number,
  started_at: Date.now(),
  last_at: Date.now(),
  messages: 1,
  tokens: 100,
  cost_brl: 0.1,
  full: false,
  preview: `Pergunta ${number}`,
});

function fakeRealtime() {
  let emit: (event: RealtimeEvent) => void = () => {};
  const realtime: Realtime = {
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
    close: () => {},
  };
  return { realtime, emit: (event: RealtimeEvent) => act(() => emit(event)) };
}

/** O MessageList do pacote é virtualizado; no jsdom todo elemento mede 0 e nenhuma linha renderizaria. */
function stubVirtualizer() {
  const rect = {
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describeC3('chat do Agente de IA no AssistantPanel (?c3assistant)', () => {
  beforeEach(() => window.history.replaceState({}, '', '/?c3assistant'));

  it('abre a conversa no painel do C3Theme, envia e mostra a resposta com ferramentas', async () => {
    stubVirtualizer();
    const api = fakeApi({
      'GET /agent_chats': [agent(3, 'Anny')],
      'GET /agent_chats/3/sessions': { current: 1, token_limit: 500_000, sessions: [session(1)] },
      'GET /agent_chats/3/messages': [],
      'POST /agent_chats/3/messages': (body) =>
        message(10, 'user', (body as { content: string }).content),
    });
    const { realtime, emit } = fakeRealtime();
    const user = userEvent.setup();
    render(<AgentChatScreen agentId={3} realtime={realtime} onSelect={vi.fn()} />);

    const chat = await screen.findByRole('region', { name: 'Conversa com Anny' });
    expect(within(chat).getByRole('heading', { name: 'Anny' })).toBeInTheDocument();
    expect(within(chat).getByText(/ninguém mais da equipe vê/)).toBeInTheDocument();

    const box = within(chat).getByPlaceholderText('Mensagem para Anny');
    await user.type(box, 'O cliente ACME pagou?{Enter}');
    await waitFor(() => expect(api.called('POST', '/agent_chats/3/messages')).toHaveLength(1));
    expect(api.called('POST', '/agent_chats/3/messages')[0].body).toEqual({
      content: 'O cliente ACME pagou?',
    });
    expect(await within(chat).findByText('O cliente ACME pagou?')).toBeInTheDocument();
    // Enquanto a resposta não chega, o painel mostra o “Pensando…” da mensagem em streaming.
    expect(await within(chat).findByText('Pensando…')).toBeInTheDocument();

    // O que o agente faz aparece como ferramenta da resposta em andamento.
    emit({
      event: 'agent_chat.progress',
      data: { agent_id: 3, chat_id: 1, step: { kind: 'tool', text: 'list_conversations' } },
    });
    expect(await within(chat).findByText(/list_conversations/)).toBeInTheDocument();

    emit({
      event: 'agent_chat.message',
      data: message(11, 'agent', 'Pagou: R$ 1.200,00 em 12/10.') as unknown as Record<string, unknown>,
    });
    expect(await within(chat).findByText('Pagou: R$ 1.200,00 em 12/10.')).toBeInTheDocument();
    expect(within(chat).queryByText('Pensando…')).not.toBeInTheDocument();
  });

  it('mostra o estado vazio com a descrição e o compositor desabilitado em sessão encerrada', async () => {
    stubVirtualizer();
    fakeApi({
      'GET /agent_chats': [agent(3, 'Anny')],
      'GET /agent_chats/3/sessions': {
        current: 2,
        token_limit: 500_000,
        sessions: [{ ...session(2), full: true }],
      },
      'GET /agent_chats/3/messages': [],
    });
    render(<AgentChatScreen agentId={3} onSelect={vi.fn()} />);

    const chat = await screen.findByRole('region', { name: 'Conversa com Anny' });
    expect(await within(chat).findByText(/ninguém mais da equipe vê/)).toBeInTheDocument();
    expect(within(chat).getByText(/chegou ao limite de tokens/)).toBeInTheDocument();
    expect(within(chat).getAllByRole('button', { name: 'Nova conversa' }).length).toBeGreaterThan(0);
    expect(within(chat).getByPlaceholderText('Mensagem para Anny')).toBeDisabled();
  });
});
