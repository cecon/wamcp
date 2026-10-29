import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewChatModal } from '../../src/agent/conversations/NewChatModal';
import { fakeApi } from './fake-api';

const inboxes = [{ id: 1, name: 'WhatsApp' }] as never[];

describe('Nova conversa from the Conversas list', () => {
  it('opens the chat with an AI agent', async () => {
    fakeApi({
      'GET /agent_chats': [{ id: 3, name: 'Anny', system: false, profile_name: 'Financeiro', last: null }],
      'GET /contacts': [],
    });
    const onAgent = vi.fn();
    render(<NewChatModal inboxes={inboxes} onClose={vi.fn()} onAgent={onAgent} onConversation={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Anny/ }));
    expect(onAgent).toHaveBeenCalledWith(3);
  });

  it('writes the first WhatsApp message to a customer', async () => {
    const api = fakeApi({
      'GET /agent_chats': [],
      'GET /contacts': [{ id: 7, name: 'ACME', phone_number: '+5511999990000' }],
      'POST /conversations': { id: 40, display_id: 12 },
    });
    const onConversation = vi.fn();
    render(
      <NewChatModal inboxes={inboxes} onClose={vi.fn()} onAgent={vi.fn()} onConversation={onConversation} />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /ACME/ }));
    await user.type(screen.getByLabelText('Mensagem'), 'Seu boleto vence amanhã.');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(onConversation).toHaveBeenCalledWith(12));
    expect(api.called('POST', '/conversations')[0].body).toEqual({
      contact_id: 7,
      inbox_id: 1,
      message: { content: 'Seu boleto vence amanhã.' },
    });
  });
});
