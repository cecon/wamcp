import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplyBox } from '../../src/agent/conversations/ReplyBox';
import { fakeApi } from './fake-api';
import { message } from './fixtures';

let supported: string[] = [];
const recorders: FakeRecorder[] = [];
const track = { stop: vi.fn() };

/** MediaRecorder double: stop() flushes one chunk and fires onstop, like the browser. */
class FakeRecorder {
  static isTypeSupported = (type: string) => supported.includes(type);
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType || '';
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['']) });
    this.ondataavailable?.({ data: new Blob(['opus']) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();
beforeEach(() => {
  supported = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'];
  recorders.length = 0;
  track.stop = vi.fn();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

function setup() {
  const api = fakeApi({
    'POST /conversations/7/messages': () => message(30, { message_type: 'outgoing' }),
    'POST /conversations/7/toggle_typing_status': {},
  });
  const onSent = vi.fn(),
    onCancelReply = vi.fn();
  const view = render(
    <ReplyBox
      path="/conversations/7"
      disabled={false}
      onSent={onSent}
      replyTo={message(4)}
      onCancelReply={onCancelReply}
    />,
  );
  const typing = () => api.called('POST', '/conversations/7/toggle_typing_status').map((c) => c.body);
  return { api, onSent, onCancelReply, typing, unmount: view.unmount, user: userEvent.setup() };
}

describe('voice notes', () => {
  it('records an OGG/Opus voice note and sends it with voice=true', async () => {
    const { api, onSent, onCancelReply, typing, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Gravar áudio' }));
    expect(await screen.findByRole('group', { name: 'Gravando áudio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tempo de gravação')).toHaveTextContent('0:00');
    expect(recorders[0].mimeType).toBe('audio/ogg;codecs=opus');
    expect(screen.getByRole('button', { name: 'Enviar (↵)' })).toBeDisabled();
    await waitFor(() => expect(typing()).toEqual([{ typing_status: 'recording', is_private: false }]));
    await user.click(screen.getByRole('button', { name: 'Enviar áudio' }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const form = api.called('POST', '/conversations/7/messages')[0].body as FormData;
    expect(form.get('voice')).toBe('true');
    expect(form.get('content')).toBe('');
    expect(form.get('in_reply_to')).toBe('4');
    const file = form.get('attachments[]') as File;
    expect(file.name).toBe('audio.ogg');
    expect(file.type).toBe('audio/ogg;codecs=opus');
    expect(file.size).toBe(4);
    expect(track.stop).toHaveBeenCalled();
    expect(onCancelReply).toHaveBeenCalled();
    expect(typing().at(-1)).toEqual({ typing_status: 'off', is_private: false });
    expect(screen.queryByRole('group', { name: 'Gravando áudio' })).not.toBeInTheDocument();
  });

  it('falls back to WebM, counts the elapsed time and can be discarded', async () => {
    supported = ['audio/webm;codecs=opus'];
    const { api, typing, user } = setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(screen.getByRole('button', { name: 'Gravar áudio' }));
    await screen.findByRole('group', { name: 'Gravando áudio' });
    expect(recorders[0].mimeType).toBe('audio/webm;codecs=opus');
    await vi.advanceTimersByTimeAsync(65_400);
    expect(screen.getByLabelText('Tempo de gravação')).toHaveTextContent('1:05');
    vi.useRealTimers();
    await user.click(screen.getByRole('button', { name: 'Descartar áudio' }));
    expect(screen.queryByRole('group', { name: 'Gravando áudio' })).not.toBeInTheDocument();
    expect(recorders[0].onstop).toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(api.called('POST', '/conversations/7/messages')).toHaveLength(0);
    await waitFor(() => expect(typing().at(-1)).toEqual({ typing_status: 'off', is_private: false }));
  });

  it('uses the browser default format and stops the microphone on unmount', async () => {
    supported = [];
    const { user, unmount } = setup();
    await user.click(screen.getByRole('button', { name: 'Gravar áudio' }));
    await screen.findByRole('group', { name: 'Gravando áudio' });
    expect(recorders[0].mimeType).toBe('');
    unmount();
    expect(recorders[0].state).toBe('inactive');
    expect(track.stop).toHaveBeenCalled();
  });

  it('explains missing support and denied microphone access', async () => {
    getUserMedia.mockRejectedValue(new Error('denied'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Gravar áudio' }));
    expect(await screen.findByText('Não foi possível acessar o microfone.')).toBeInTheDocument();
    vi.stubGlobal('MediaRecorder', undefined);
    await user.click(screen.getByRole('button', { name: 'Gravar áudio' }));
    expect(await screen.findByText('Gravação de áudio não é suportada neste navegador.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Nota privada' }));
    expect(screen.queryByRole('button', { name: 'Gravar áudio' })).not.toBeInTheDocument();
  });
});
