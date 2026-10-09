import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageItem } from '../../src/agent/conversations/MessageItem';
import { TypingIndicator } from '../../src/agent/conversations/TypingIndicator';
import { humanSize, upload, type RealtimeEvent } from '../../src/agent/api';
import type { Message } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { attachment, message } from './fixtures';

const one = (m: Message) =>
  render(
    <ul>
      <MessageItem message={m} />
    </ul>,
  );

describe('message bubbles', () => {
  it('renders WhatsApp formatting as React nodes, never raw HTML', () => {
    one(
      message(1, {
        content: '*negrito* _itálico_ ~riscado~ ```x = 1``` snake_case_var 2*3*4 *_ambos_* <b>tag</b>',
      }),
    );
    expect(screen.getByText('negrito').tagName).toBe('STRONG');
    expect(screen.getByText('itálico').tagName).toBe('EM');
    expect(screen.getByText('riscado').tagName).toBe('S');
    expect(screen.getByText('x = 1').tagName).toBe('CODE');
    expect(screen.getByText('ambos').tagName).toBe('EM');
    expect(screen.getByText('ambos').parentElement!.tagName).toBe('STRONG');
    expect(screen.getByText(/snake_case_var 2\*3\*4/)).toBeInTheDocument();
    expect(screen.getByText(/<b>tag<\/b>/)).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('shows image, audio, voice note, video, sticker and file attachments', async () => {
    const user = userEvent.setup();
    one(
      message(1, {
        content: 'Segue',
        attachments: [
          attachment(1, { file_type: 'image', file_name: 'foto.jpg', mime_type: 'image/jpeg' }),
          attachment(2, { file_type: 'audio', voice: true, duration: 65 }),
          attachment(3, { file_type: 'audio', voice: false }),
          attachment(4, { file_type: 'video' }),
          attachment(5, { file_type: 'sticker' }),
          attachment(6, { file_name: 'nota.pdf' }),
          attachment(7, { file_type: 'image', file_name: null, file_size: null }),
          attachment(8, { file_name: null, file_size: null }),
          attachment(9, { file_type: 'audio', voice: true, duration: null }),
        ],
      }),
    );
    expect(screen.getByText(/Mensagem de voz · 1:05/)).toBeInTheDocument();
    expect(screen.getAllByLabelText('Mensagem de voz')[0]).toHaveAttribute('src', '/api/v1/attachments/2');
    expect(screen.getByLabelText('Áudio').tagName).toBe('AUDIO');
    expect(screen.getByLabelText('Vídeo').tagName).toBe('VIDEO');
    expect(screen.getByAltText('Figurinha')).toHaveAttribute('src', '/api/v1/attachments/5');
    expect(screen.getByText('nota.pdf')).toBeInTheDocument();
    expect(screen.getByText('1,5 MB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar nota.pdf' })).toHaveAttribute(
      'href',
      '/api/v1/attachments/6',
    );
    expect(screen.getByRole('link', { name: 'Baixar Arquivo' })).toBeInTheDocument();
    expect(screen.getByText('Segue')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir imagem foto.jpg' }));
    const dialog = screen.getByRole('dialog', { name: 'foto.jpg' });
    expect(within(dialog).getByRole('link', { name: 'Baixar' })).toHaveAttribute(
      'href',
      '/api/v1/attachments/1',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir imagem Imagem' }));
    expect(screen.getByRole('dialog', { name: 'Imagem' })).toBeInTheDocument();
  });

  it('marks deleted and edited messages and groups reactions', () => {
    render(
      <ul>
        <MessageItem
          message={message(1, {
            content: null,
            attachments: [attachment(1, { file_type: 'image' })],
            content_attributes: {
              deleted: true,
              reactions: [{ emoji: '👍', sender_type: 'contact', sender_id: 1, sender_name: 'J' }],
            },
          })}
        />
        <MessageItem
          message={message(2, {
            content: 'novo texto',
            content_attributes: {
              edited: true,
              previous_content: 'texto antigo',
              reactions: [
                { emoji: '👍', sender_type: 'contact', sender_id: 50, sender_name: 'João' },
                { emoji: '👍', sender_type: 'user', sender_id: 2, sender_name: 'Maria' },
                { emoji: '❤️', sender_type: 'user', sender_id: 3, sender_name: null },
              ],
            },
          })}
        />
        <MessageItem message={message(3, { content_attributes: { edited: true } })} />
      </ul>,
    );
    expect(screen.getByText('Esta mensagem foi apagada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir imagem/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('(editada)')[0]).toHaveAttribute('title', 'Antes: texto antigo');
    const reactions = screen.getByRole('list', { name: 'Reações' });
    expect(within(reactions).getByTitle('João, Maria')).toHaveTextContent('👍2');
    expect(within(reactions).getByTitle('Contato')).toHaveTextContent('❤️');
  });

  it('formats sizes and reports upload failures', async () => {
    expect(humanSize(null)).toBe('');
    expect(humanSize(820)).toBe('820 B');
    expect(humanSize(12 * 1024)).toBe('12 KB');
    fakeApi({
      'POST /up': () => {
        throw status(413, 'Arquivo grande demais');
      },
    });
    await expect(upload('/up', new FormData())).rejects.toThrow('Arquivo grande demais');
    vi.stubGlobal('fetch', async () => new Response('x', { status: 500 }));
    await expect(upload('/up', new FormData())).rejects.toThrow('Não foi possível enviar o arquivo.');
  });
});

describe('typing indicator', () => {
  it('shows who is typing or recording and hides on typing_off or after 10 s', () => {
    vi.useFakeTimers();
    let emit: (e: RealtimeEvent) => void = () => {};
    const realtime = {
      subscribe: (listener: (e: RealtimeEvent) => void) => {
        emit = (e) => act(() => listener(e));
        return () => {};
      },
      close: () => {},
    };
    const { unmount } = render(<TypingIndicator realtime={realtime} displayId={7} currentUserId={1} />);
    const on = (data: object) => emit({ event: 'conversation.typing_on', data: { display_id: 7, ...data } });
    on({ user: { type: 'contact', id: 50, name: 'João' } });
    expect(screen.getByRole('status')).toHaveTextContent('João está digitando…');
    emit({ event: 'conversation.typing_off', data: { display_id: 7, user: { type: 'contact', id: 50 } } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    on({ recording: true, user: { type: 'user', id: 2, name: 'Maria' } });
    expect(screen.getByRole('status')).toHaveTextContent('Maria está gravando áudio…');
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    on({ user: { type: 'user', id: 1, name: 'Eu' } });
    on({ display_id: 8, user: { type: 'contact', name: 'Outro' } });
    emit({ event: 'message.created', data: { display_id: 7 } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    on({});
    expect(screen.getByRole('status')).toHaveTextContent('Contato está digitando…');
    unmount();
    vi.useRealTimers();
  });
});
