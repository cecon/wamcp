import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { POLL_MS } from '../../src/agent/settings/connections/ConnectionDetailPage';
import type { ConnectionDetail } from '../../src/agent/settings/connections/model';
import { fakeApi, status } from './fake-api';
import { connected, renderConnections } from './connection-harness';

const QR = 'QR Code para conectar o WhatsApp';

describe('WhatsApp connections list', () => {
  it('lists connections with their status and creates a new one with its inbox', async () => {
    let created: ConnectionDetail | null = null;
    const api = fakeApi({
      'GET /sessions': () => [
        { id: 's1', name: 'Suporte', phone: '5511999999999', status: 'connected' },
        { id: 's2', name: 'Vendas', phone: null, status: 'qr' },
        { id: 's3', name: 'Antigo', phone: null, status: 'disconnected' },
      ],
      'POST /sessions': (body) => {
        created = { ...(body as { name: string }), id: 's9', phone: null, status: 'disconnected' };
        return created;
      },
      'GET /sessions/s9': () => ({ ...created, qr: null, mcpUrl: 'https://x/mcp/s9' }),
    });
    const { user, onChange } = renderConnections();
    expect(await screen.findByText('Suporte')).toBeInTheDocument();
    expect(screen.getByText('3 conexões')).toBeInTheDocument();
    expect(screen.getByText('+5511999999999')).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('Aguardando QR Code')).toBeInTheDocument();
    expect(screen.getByText('Desconectado')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova conexão' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova conexão' });
    await user.type(within(dialog).getByLabelText('Nome da conexão'), '  Financeiro ');
    await user.click(within(dialog).getByRole('button', { name: 'Criar conexão' }));
    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    expect(api.called('POST', '/sessions')[0].body).toEqual({ name: 'Financeiro' });
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText('Pronto para conectar')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Conexões WhatsApp' }));
    expect(await screen.findByText('Vendas')).toBeInTheDocument();
  });

  it('shows the empty state, creation errors and opens a connection', async () => {
    fakeApi({
      'GET /sessions': [],
      'POST /sessions': () => {
        throw status(400, 'Nome inválido');
      },
    });
    const { user } = renderConnections();
    expect(await screen.findByText(/Nenhuma conexão ainda/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova conexão' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova conexão' });
    expect(within(dialog).getByRole('button', { name: 'Criar conexão' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Nome da conexão'), 'X');
    await user.click(within(dialog).getByRole('button', { name: 'Criar conexão' }));
    expect(await within(dialog).findByText('Nome inválido')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports a connection that cannot be loaded', async () => {
    fakeApi({
      'GET /sessions/zz': () => {
        throw status(404, 'Sessão não encontrada');
      },
    });
    renderConnections('zz');
    expect(await screen.findByRole('alert')).toHaveTextContent('Sessão não encontrada');
  });
});

describe('pairing a connection', () => {
  it('connects, polls the QR Code until the phone is connected, then stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let detail: ConnectionDetail = { ...connected, phone: null, status: 'disconnected' };
    const api = fakeApi({
      'GET /sessions/s1': () => detail,
      'POST /sessions/s1/connect': () => {
        detail = { ...detail, status: 'qr', qr: 'data:image/svg+xml;base64,PHN2Zz4=' };
        return { ok: true };
      },
    });
    const { user, onChange } = renderConnections('s1', { advanceTimers: vi.advanceTimersByTime });
    expect(await screen.findByText('Pronto para conectar')).toBeInTheDocument();
    expect(screen.getByText('Nenhum número conectado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conectar WhatsApp' }));
    const image = await screen.findByRole('img', { name: QR });
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('src', 'data:image/svg+xml;base64,PHN2Zz4=');
    expect(screen.getByRole('button', { name: 'Conectar WhatsApp' })).toBeDisabled();
    expect(onChange).toHaveBeenCalled();

    // A raw QR string (not an image) is encoded in the browser.
    detail = { ...detail, qr: '2@abcdef,ghijkl,mnopqr' };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await waitFor(() => expect(screen.getByRole('img', { name: QR }).tagName.toLowerCase()).toBe('svg'));

    detail = { ...detail, status: 'connected', qr: null, phone: '5511999999999' };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await screen.findByText('Tudo conectado')).toBeInTheDocument();
    expect(screen.getByText('+5511999999999')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WhatsApp conectado' })).toBeDisabled();
    const polls = api.called('GET', '/sessions/s1').length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.called('GET', '/sessions/s1')).toHaveLength(polls);
    vi.useRealTimers();
  });

  it('disconnects, and logs out only after confirming', async () => {
    let detail: ConnectionDetail = { ...connected, error: 'Falha anterior' };
    const api = fakeApi({
      'GET /sessions/s1': () => detail,
      'POST /sessions/s1/disconnect': () => {
        detail = { ...detail, status: 'reconnecting' };
        return { ok: true };
      },
      'POST /sessions/s1/logout': () => {
        detail = { ...detail, status: 'disconnected', phone: null };
        return { ok: true };
      },
    });
    const { user } = renderConnections('s1');
    expect(await screen.findByText('Falha anterior')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(api.called('POST', '/sessions/s1/disconnect')).toHaveLength(1));
    expect(await screen.findByText('Reconectando')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desconectar e sair' }));
    let dialog = screen.getByRole('dialog', { name: 'Desconectar e sair?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(api.called('POST', '/sessions/s1/logout')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Desconectar e sair' }));
    dialog = screen.getByRole('dialog', { name: 'Desconectar e sair?' });
    await user.click(within(dialog).getByRole('button', { name: 'Desconectar e sair' }));
    await waitFor(() => expect(api.called('POST', '/sessions/s1/logout')).toHaveLength(1));
    expect(await screen.findByText('Desconectado')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument();
  });

  it('shows action failures inline', async () => {
    fakeApi({
      'GET /sessions/s1': { ...connected, status: 'disconnected' },
      'POST /sessions/s1/connect': () => {
        throw status(500, 'Não foi possível conectar');
      },
    });
    const { user } = renderConnections('s1');
    await user.click(await screen.findByRole('button', { name: 'Conectar WhatsApp' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar');
  });
});
