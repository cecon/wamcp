import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplyBox } from '../../src/agent/conversations/ReplyBox';
import { MessageItem } from '../../src/agent/conversations/MessageItem';
import { snippet } from '../../src/agent/conversations/messageText';
import {
  mentionCandidates,
  mentionQuery,
  plainMentions,
  splitMentions,
  withMentionMarkup,
} from '../../src/agent/conversations/mentions';
import type { User } from '../../src/agent/types';
import { fakeApi } from './fake-api';
import { admin, attachment, conversation, maria, message } from './fixtures';

const pedro: User = { ...maria, id: 3, name: 'Pedro Lima', email: 'pedro@example.com', inbox_ids: [99] };
const ana: User = { ...admin, id: 4, name: 'Ana Admin', email: 'ana@example.com', inbox_ids: [] };
const gone: User = { ...maria, id: 5, name: 'Mário Antigo', active: 0 };
const agents = [admin, maria, pedro, ana, gone];

function renderNote() {
  const api = fakeApi({
    'POST /conversations/7/messages': (body) =>
      message(30, { ...(body as object), private: true, message_type: 'outgoing' }),
  });
  const onSent = vi.fn();
  render(
    <ReplyBox
      path="/conversations/7"
      disabled={false}
      onSent={onSent}
      conversation={conversation}
      user={admin}
      agents={agents}
    />,
  );
  return { api, onSent, user: userEvent.setup() };
}

describe('mention helpers', () => {
  it('parses, previews and builds Chatwoot mention markdown', () => {
    const note = 'Oi [@Maria Souza](mention://user/2/Maria%20Souza) e [@Time](mention://team/9/Time)!';
    expect(splitMentions(note)).toEqual([
      { text: 'Oi ' },
      { mention: 'Maria Souza', id: 2 },
      { text: ' e ' },
      { mention: 'Time', id: 9 },
      { text: '!' },
    ]);
    expect(splitMentions('sem menção')).toEqual([{ text: 'sem menção' }]);
    expect(plainMentions(note)).toBe('Oi @Maria Souza e @Time!');
    expect(withMentionMarkup('@Maria', [])).toBe('@Maria');
    expect(withMentionMarkup('@Maria Souza e @Mariana, @Maria', [maria, { id: 8, name: 'Maria' }])).toBe(
      '[@Maria Souza](mention://user/2/Maria%20Souza) e @Mariana, [@Maria](mention://user/8/Maria)',
    );
    expect(mentionQuery('email@dominio', 13)).toBeUndefined();
    expect(mentionQuery('oi @jo', 6)).toEqual({ start: 3, query: 'jo' });
    expect(mentionCandidates(agents, 'mario', 10)).toEqual([]);
    expect(mentionCandidates(agents, '', undefined).map((a) => a.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('composer mentions', () => {
  it('picks agents who can see the inbox with the keyboard and sends mention markdown', async () => {
    const { api, onSent, user } = renderNote();
    const box = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.type(box, '@');
    expect(screen.queryByRole('listbox', { name: 'Mencionar agente' })).not.toBeInTheDocument();
    await user.clear(box);
    await user.click(screen.getByRole('tab', { name: 'Nota privada' }));
    const note = screen.getByRole('textbox', { name: 'Nota privada' });
    await user.type(note, 'Oi @');
    const list = await screen.findByRole('listbox', { name: 'Mencionar agente' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['AAdminadmin@example.com', 'MSMaria Souzamaria@example.com', 'AAAna Adminana@example.com']);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.type(note, 'mar');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(note).toHaveValue('Oi @Maria Souza ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.type(note, 'veja{Enter}');
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(api.called('POST', '/conversations/7/messages')[0].body).toEqual({
      content: 'Oi [@Maria Souza](mention://user/2/Maria%20Souza) veja',
      private: true,
    });
  });

  it('picks with the mouse and Tab and keeps unpicked names as plain text', async () => {
    const { api, onSent, user } = renderNote();
    await user.click(screen.getByRole('tab', { name: 'Nota privada' }));
    const note = screen.getByRole('textbox', { name: 'Nota privada' });
    await user.type(note, '@ana');
    await user.keyboard('{Tab}');
    expect(note).toHaveValue('@Ana Admin ');
    await user.type(note, 'e @');
    const list = await screen.findByRole('listbox', { name: 'Mencionar agente' });
    await user.hover(within(list).getAllByRole('option')[0].querySelector('button')!);
    await user.click(within(list).getByText('Admin'));
    await user.type(note, 'e @Pedro');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar nota (↵)' }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect((api.called('POST', '/conversations/7/messages')[0].body as { content: string }).content).toBe(
      '[@Ana Admin](mention://user/4/Ana%20Admin) e [@Admin](mention://user/1/Admin) e @Pedro',
    );
  });
});

describe('mention rendering', () => {
  it('shows mentions in notes as chips, never as links, and in previews as @Nome', () => {
    const note = message(5, {
      private: true,
      message_type: 'outgoing',
      sender_type: 'user',
      sender_name: 'Admin',
      content: 'Olá [@Maria Souza](mention://user/2/Maria%20Souza), veja *isso*',
    });
    render(
      <ul>
        <MessageItem message={note} />
      </ul>,
    );
    const chip = screen.getByText('@Maria Souza');
    expect(chip).toHaveAttribute('data-mention', '2');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/mention:\/\//)).not.toBeInTheDocument();
    expect(screen.getByText('isso').tagName).toBe('STRONG');
    expect(snippet(note)).toBe('Olá @Maria Souza, veja *isso*');
    expect(snippet(message(6, { content: null }))).toBe('');
    expect(snippet(message(7, { content: '', attachments: [attachment(1, { voice: true })] }))).toBe(
      '🎤 Mensagem de voz',
    );
    expect(snippet(message(8, { content: ' ', attachments: [attachment(2)] }))).toBe('📄 Arquivo');
  });
});
