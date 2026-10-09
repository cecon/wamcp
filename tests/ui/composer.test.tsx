import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplyBox } from '../../src/agent/conversations/ReplyBox';
import { setCsrf } from '../../src/agent/api';
import { fakeApi, status } from './fake-api';
import { admin, conversation, message } from './fixtures';

const PATH = '/conversations/7';
const png = () => new File(['png'], 'print.png', { type: 'image/png' });
const pdf = () => new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' });
const box = () => screen.getByRole('textbox', { name: 'Mensagem' });
const formOf = (body: unknown) => body as FormData;

function renderBox(extra: Partial<Parameters<typeof ReplyBox>[0]> = {}) {
  const onSent = vi.fn();
  const view = render(
    <ReplyBox
      path={PATH}
      disabled={false}
      onSent={onSent}
      conversation={conversation}
      user={admin}
      {...extra}
    />,
  );
  return { onSent, ...view };
}

describe('composer attachments', () => {
  it('attaches files, previews and removes them, then sends multipart with the CSRF header', async () => {
    setCsrf('tok');
    const api = fakeApi({
      'POST /conversations/7/messages': () => [message(20), message(21)],
    });
    const user = userEvent.setup();
    const { onSent } = renderBox({ replyTo: message(3), onCancelReply: vi.fn() });
    await user.click(screen.getByRole('button', { name: 'Anexar arquivos' }));
    await user.upload(screen.getByTestId('file-input'), [png(), pdf(), pdf()]);
    expect(screen.getByAltText('print.png')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getAllByText('contrato.pdf')).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Remover contrato.pdf' })[0]);
    expect(screen.getAllByText('contrato.pdf')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Enviar (↵)' })).toBeEnabled();
    await user.type(box(), 'Segue o contrato{Enter}');
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(2));
    const call = api.called('POST', '/conversations/7/messages')[0];
    const form = formOf(call.body);
    expect(form.get('content')).toBe('Segue o contrato');
    expect(form.get('private')).toBe('false');
    expect(form.get('in_reply_to')).toBe('3');
    expect(form.get('voice')).toBeNull();
    expect(form.getAll('attachments[]').map((f) => (f as File).name)).toEqual(['print.png', 'contrato.pdf']);
    expect(call.headers).toEqual({ 'X-CSRF-Token': 'tok' });
    expect(screen.queryByRole('list', { name: 'Anexos' })).not.toBeInTheDocument();
    expect(box()).toHaveValue('');
  });

  it('accepts pasted images and dropped files', async () => {
    fakeApi({});
    renderBox();
    fireEvent.paste(box(), { clipboardData: { files: [pdf()] } });
    expect(screen.queryByRole('list', { name: 'Anexos' })).not.toBeInTheDocument();
    fireEvent.paste(box(), { clipboardData: { files: [png()] } });
    expect(screen.getByAltText('print.png')).toBeInTheDocument();
    const zone = box().closest('div')!;
    fireEvent.dragOver(zone);
    expect(screen.getByText('Solte os arquivos para anexar')).toBeInTheDocument();
    fireEvent.dragLeave(zone, { relatedTarget: null });
    expect(screen.queryByText('Solte os arquivos para anexar')).not.toBeInTheDocument();
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [pdf()] } });
    expect(screen.queryByText('Solte os arquivos para anexar')).not.toBeInTheDocument();
    expect(screen.getByText('contrato.pdf')).toBeInTheDocument();
  });

  it('reports upload errors and ignores drops on a resolved conversation', async () => {
    fakeApi({
      'POST /conversations/7/messages': () => {
        throw status(413, 'Arquivo grande demais');
      },
    });
    const user = userEvent.setup();
    const { rerender } = renderBox();
    await user.upload(screen.getByTestId('file-input'), [pdf()]);
    await user.click(screen.getByRole('button', { name: 'Enviar (↵)' }));
    expect(await screen.findByText('Arquivo grande demais')).toBeInTheDocument();
    expect(screen.getByText('contrato.pdf')).toBeInTheDocument();
    rerender(<ReplyBox path="/conversations/8" disabled onSent={vi.fn()} />);
    const zone = screen.getByRole('textbox', { name: 'Mensagem' }).closest('div')!;
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    expect(screen.queryByAltText('print.png')).not.toBeInTheDocument();
  });
});

describe('composer helpers', () => {
  it('inserts emojis at the caret', async () => {
    fakeApi({});
    const user = userEvent.setup();
    renderBox();
    await user.type(box(), 'Olá mundo');
    (box() as HTMLTextAreaElement).setSelectionRange(3, 3);
    await user.click(screen.getByRole('button', { name: 'Inserir emoji' }));
    await user.click(screen.getByRole('menuitem', { name: '😀' }));
    expect(box()).toHaveValue('Olá😀 mundo');
    await waitFor(() => expect((box() as HTMLTextAreaElement).selectionStart).toBe(5));
  });

  it('fills canned response variables from the conversation and agent', async () => {
    fakeApi({
      'GET /canned_responses': [
        {
          id: 1,
          short_code: 'oi',
          content:
            'Olá {{contact.name}}, sou {{ agent.name }} do {{inbox.name}} (#{{conversation.id}}, {{contact.phone}}) {{outra.coisa}}',
        },
      ],
    });
    const user = userEvent.setup();
    renderBox({ conversation: { ...conversation, contact_phone: null } });
    await user.type(box(), '/oi');
    await screen.findByRole('listbox', { name: 'Respostas prontas' });
    await user.keyboard('{Tab}');
    expect(box()).toHaveValue('Olá João Cliente, sou Admin do Suporte (#7, ) {{outra.coisa}}');
  });

  it('keeps a draft per conversation and survives blocked storage', async () => {
    fakeApi({});
    const user = userEvent.setup();
    const first = renderBox();
    await user.type(box(), 'rascunho');
    first.unmount();
    renderBox().unmount();
    expect(localStorage.getItem('wamcp.agent.draft:/conversations/7')).toBe('rascunho');
    render(<ReplyBox path={PATH} disabled={false} onSent={vi.fn()} />);
    expect(box()).toHaveValue('rascunho');
    await user.clear(box());
    expect(localStorage.getItem('wamcp.agent.draft:/conversations/7')).toBeNull();
    const other = render(<ReplyBox path="/conversations/8" disabled={false} onSent={vi.fn()} />);
    expect(other.getAllByRole('textbox', { name: 'Mensagem' })[1]).toHaveValue('');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const blocked = render(<ReplyBox path="/conversations/9" disabled={false} onSent={vi.fn()} />);
    const area = blocked.getAllByRole('textbox', { name: 'Mensagem' })[2];
    expect(area).toHaveValue('');
    await user.type(area, 'x');
    expect(area).toHaveValue('x');
  });
});

describe('typing status', () => {
  it('throttles "on", sends "off" when idle, on send and on unmount, flagging private notes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi({
      'POST /conversations/7/toggle_typing_status': {},
      'POST /conversations/7/messages': (body) => message(9, body as object),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const sent = () => api.called('POST', '/conversations/7/toggle_typing_status').map((c) => c.body);
    const { unmount } = renderBox();
    await user.type(box(), 'abc');
    expect(sent()).toEqual([{ typing_status: 'on', is_private: false }]);
    act(() => vi.advanceTimersByTime(3100));
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toEqual({ typing_status: 'off', is_private: false });
    await user.type(box(), 'd');
    act(() => vi.advanceTimersByTime(3100));
    await user.type(box(), 'e');
    expect(sent()).toHaveLength(5);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent()).toHaveLength(6));
    expect(sent()[5]).toEqual({ typing_status: 'off', is_private: false });
    await user.click(screen.getByRole('tab', { name: 'Nota privada' }));
    await user.type(screen.getByRole('textbox', { name: 'Nota privada' }), 'n');
    expect(sent()[6]).toEqual({ typing_status: 'on', is_private: true });
    await user.clear(screen.getByRole('textbox', { name: 'Nota privada' }));
    expect(sent()[7]).toEqual({ typing_status: 'off', is_private: true });
    await user.type(screen.getByRole('textbox', { name: 'Nota privada' }), 'm');
    unmount();
    expect(sent().at(-1)).toEqual({ typing_status: 'off', is_private: true });
    expect(sent()).toHaveLength(10);
    vi.useRealTimers();
  });
});
