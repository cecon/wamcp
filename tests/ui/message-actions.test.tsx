import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationsScreen } from '../../src/agent/conversations/ConversationsScreen';
import { connectRealtime } from '../../src/agent/api';
import type { Reaction } from '../../src/agent/types';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, conversation, inbox, labels, maria, message, team, workspaceRoutes } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const thread = [
  message(1, { content: 'Olá, tudo bem?' }),
  message(2, {
    message_type: 'outgoing',
    sender_type: 'user',
    sender_name: 'Admin',
    content: 'Tudo ótimo',
    content_attributes: {
      in_reply_to: 1,
      reactions: [{ emoji: '❤️', sender_type: 'contact', sender_id: 50, sender_name: 'João Cliente' }],
    },
  }),
  message(3, { message_type: 'outgoing', sender_name: 'Admin', status: 'failed', content: 'Falhou' }),
  message(4, { content: 'Resposta a antiga', content_attributes: { in_reply_to: 999 } }),
  message(5, { message_type: 'outgoing', private: true, sender_name: 'Admin', content: 'nota' }),
];

function renderConversation() {
  return render(
    <ConversationsScreen
      route={{ page: 'conversations', displayId: 7 }}
      user={admin}
      catalog={catalog}
      realtime={connectRealtime(() => {})}
      onNavigate={vi.fn()}
    />,
  );
}
const row = (id: number) => within(document.getElementById(`message${id}`)!);

describe('message actions in the conversation', () => {
  it('quotes, replies, reacts, copies, deletes and retries', async () => {
    const mine = (emoji: string): Reaction[] =>
      emoji ? [{ emoji, sender_type: 'user', sender_id: 1, sender_name: 'Admin' }] : [];
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations/7/messages': thread,
      'POST /conversations/7/messages': (body) =>
        message(6, { ...(body as object), message_type: 'outgoing' }),
      'POST /conversations/7/messages/1/reactions': (body) =>
        message(1, {
          content: 'Olá, tudo bem?',
          content_attributes: { reactions: mine((body as { emoji: string }).emoji) },
        }),
      'DELETE /conversations/7/messages/2': message(2, {
        message_type: 'outgoing',
        content: null,
        content_attributes: { deleted: true },
      }),
      'POST /conversations/7/messages/3/retry': () => {
        throw status(422, 'Sessão desconectada');
      },
    });
    const user = userEvent.setup();
    renderConversation();
    expect(await screen.findByText('Tudo ótimo')).toBeInTheDocument();

    // Quote preview jumps to the original message.
    const quote = row(2).getByRole('button', { name: /mensagem citada de João Cliente/ });
    expect(quote).toHaveTextContent('Olá, tudo bem?');
    expect(row(4).queryByRole('button', { name: /mensagem citada/ })).not.toBeInTheDocument();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    await user.click(quote);
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(document.getElementById('message1')).toHaveClass('bg-n-alpha-1');

    // Reply sets the composer bar and sends in_reply_to.
    await user.click(row(1).getByRole('button', { name: 'Responder' }));
    expect(screen.getByText(/Respondendo a/)).toHaveTextContent('Respondendo a João Cliente: Olá, tudo bem?');
    await user.click(screen.getByRole('button', { name: 'Cancelar resposta' }));
    expect(screen.queryByText(/Respondendo a/)).not.toBeInTheDocument();
    await user.click(row(1).getByRole('button', { name: 'Responder' }));
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'Claro{Enter}');
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/messages')[0].body).toEqual({
        content: 'Claro',
        private: false,
        in_reply_to: 1,
      }),
    );
    expect(screen.queryByText(/Respondendo a/)).not.toBeInTheDocument();

    // React, then pick the same emoji again to remove it.
    await user.click(row(1).getByRole('button', { name: 'Reagir' }));
    await user.click(screen.getByRole('menuitem', { name: '👍' }));
    expect(await row(1).findByRole('list', { name: 'Reações' })).toHaveTextContent('👍');
    await user.click(row(1).getByRole('button', { name: 'Reagir' }));
    expect(screen.getByRole('menuitem', { name: '👍' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('menuitem', { name: '👍' }));
    await waitFor(() => expect(row(1).queryByRole('list', { name: 'Reações' })).not.toBeInTheDocument());
    expect(api.called('POST', '/conversations/7/messages/1/reactions').map((c) => c.body)).toEqual([
      { emoji: '👍' },
      { emoji: '' },
    ]);
    expect(row(5).queryByRole('button', { name: 'Reagir' })).not.toBeInTheDocument();

    // Copy text.
    await user.click(row(1).getByRole('button', { name: 'Copiar texto' }));
    expect(await navigator.clipboard.readText()).toBe('Olá, tudo bem?');
    expect(row(1).getByRole('button', { name: 'Texto copiado' })).toBeInTheDocument();

    // Delete only outgoing messages, after confirmation.
    expect(row(1).queryByRole('button', { name: 'Apagar' })).not.toBeInTheDocument();
    await user.click(row(5).getByRole('button', { name: 'Apagar' }));
    expect(screen.getByRole('dialog', { name: 'Apagar mensagem?' })).toHaveTextContent(
      'nota privada será removida',
    );
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(row(2).getByRole('button', { name: 'Apagar' }));
    const dialog = screen.getByRole('dialog', { name: 'Apagar mensagem?' });
    await user.click(within(dialog).getByRole('button', { name: 'Apagar' }));
    expect(await row(2).findByText('Esta mensagem foi apagada')).toBeInTheDocument();
    expect(row(2).queryByRole('toolbar')).not.toBeInTheDocument();
    expect(api.called('DELETE', '/conversations/7/messages/2')).toHaveLength(1);

    // Retry a failed message; failures surface in the conversation.
    await user.click(row(3).getByRole('button', { name: /Reenviar/ }));
    expect(await screen.findByText('Sessão desconectada')).toBeInTheDocument();
    api.route('POST /conversations/7/messages/3/retry', {});
    await user.click(row(3).getByRole('button', { name: /Reenviar/ }));
    await waitFor(() => expect(api.called('POST', '/conversations/7/messages/3/retry')).toHaveLength(2));
  });

  it('shows typing from SSE under the messages', async () => {
    fakeApi(workspaceRoutes());
    renderConversation();
    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    FakeEventSource.emit('conversation.typing_on', {
      id: conversation.id,
      display_id: 7,
      recording: false,
      is_private: false,
      user: { type: 'contact', id: 50, name: 'João Cliente' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('João Cliente está digitando…');
    FakeEventSource.emit('conversation.typing_off', { display_id: 7, user: { type: 'contact', id: 50 } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
