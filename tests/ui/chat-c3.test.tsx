import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Realtime, RealtimeEvent } from '../../src/agent/api';
import { C3Thread } from '../../src/agent/chat/C3Thread';
import { toC3Message } from '../../src/agent/chat/c3Mapping';
import { createChatTransport } from '../../src/agent/chat/c3Transport';
import type { Message } from '../../src/agent/types';
import { fakeApi } from './fake-api';

const message = (patch: Partial<Message> = {}): Message => ({
  id: 11,
  conversation_id: 7,
  message_type: 'incoming',
  content: 'Oi!',
  content_type: 'text',
  private: false,
  status: 'delivered',
  sender_type: 'contact',
  sender_name: 'Ana',
  content_attributes: {},
  created_at: 1_700_000_000,
  ...patch,
});

/** Realtime de teste: guarda os listeners para emitir eventos manualmente. */
function fakeRealtime() {
  const listeners: ((event: RealtimeEvent) => void)[] = [];
  const realtime: Realtime = {
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    close: vi.fn(),
  };
  return {
    realtime,
    emit: (event: string, data: Record<string, unknown>) => listeners.forEach((l) => l({ event, data })),
  };
}

describe('@c3theme/chat sobre a API do app', () => {
  it('traduz mensagem, direção, status, anexos e resposta citada', () => {
    const mapped = toC3Message(
      message({
        message_type: 'outgoing',
        status: 'read',
        sender_type: 'user',
        sender_name: 'Admin',
        content_attributes: { in_reply_to: 10 },
        attachments: [
          {
            id: 1,
            message_id: 11,
            file_type: 'image',
            mime_type: 'image/png',
            file_name: 'foto.png',
            file_size: 2048,
            duration: null,
            voice: false,
            downloaded: true,
            data_url: '/api/v1/attachments/1',
          },
        ],
      }),
      { me: { id: '1', name: 'Admin' }, contactName: 'Ana' },
    );
    expect(mapped).toMatchObject({
      id: '11',
      conversationId: '7',
      direction: 'out',
      status: 'read',
      replyTo: '10',
      author: { id: '1', name: 'Admin' },
      attachments: [
        { id: '1', name: 'foto.png', size: 2048, contentType: 'image/png', url: '/api/v1/attachments/1' },
      ],
    });
    expect(mapped.createdAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('carrega, envia e traduz eventos do SSE pelo transporte', async () => {
    const api = fakeApi({
      'GET /conversations/7/messages': [message()],
      'POST /conversations/7/messages': (body) =>
        message({ id: 12, message_type: 'outgoing', content: (body as { content: string }).content }),
    });
    const { realtime, emit } = fakeRealtime();
    const transport = createChatTransport({
      displayId: 7,
      contactName: 'Ana',
      me: { id: '1', name: 'Admin' },
      realtime,
    });

    const page = await transport.loadMessages('7', { limit: 50 });
    expect(page.messages[0]).toMatchObject({ id: '11', direction: 'in' });
    expect(page.hasMore).toBe(false);

    const sent = await transport.send({ clientId: 'c1', conversationId: '7', text: 'Resposta' });
    expect(api.called('POST', '/conversations/7/messages')[0].body).toMatchObject({
      content: 'Resposta',
      private: false,
    });
    expect(sent).toMatchObject({ id: '12', clientId: 'c1', direction: 'out' });

    const events: unknown[] = [];
    const stop = transport.subscribe('7', (event) => events.push(event));
    emit('message.created', { ...message({ id: 13 }), display_id: 7 });
    emit('conversation.typing_on', { display_id: 7, user: { id: 2, name: 'Ana' } });
    emit('message.created', { ...message({ id: 14 }), display_id: 99 });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'message', message: { id: '13' } });
    expect(events[1]).toMatchObject({ type: 'typing', typing: true, author: { name: 'Ana' } });
    stop();
  });

  it('rende a thread do pacote e envia pelo composer', async () => {
    const api = fakeApi({
      'GET /conversations/7/messages': [message({ content: 'Olá do C3' })],
      'POST /conversations/7/messages': () => message({ id: 12, content: 'Resposta' }),
    });
    const { realtime } = fakeRealtime();
    // O MessageList do pacote é virtualizado: no jsdom todo elemento mede 0 e nenhuma linha renderizaria.
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
    const user = userEvent.setup();
    render(
      <C3Thread
        displayId={7}
        contactName="Ana"
        currentUserId={1}
        currentUserName="Admin"
        realtime={realtime}
      />,
    );

    expect(await screen.findByText('Olá do C3', {}, { timeout: 8000 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mensagem'), 'Resposta');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await waitFor(() => expect(api.called('POST', '/conversations/7/messages')).toHaveLength(1));
    expect(api.called('POST', '/conversations/7/messages')[0].body).toMatchObject({ content: 'Resposta' });
  });
});
