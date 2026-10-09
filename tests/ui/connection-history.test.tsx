import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { HistoryMessage } from '../../src/agent/settings/connections/model';
import { fakeApi, status } from './fake-api';
import { connected, renderConnections } from './connection-harness';

const MARIA = '5511911112222@s.whatsapp.net';
const GROUP = '120363000000@g.us';
const chats = [
  { jid: MARIA, name: 'Maria', preview: 'Até amanhã', updated: 20 },
  { jid: GROUP, name: null, preview: null, updated: 10 },
];
const msg = (n: number, fields: Partial<HistoryMessage> = {}): HistoryMessage => ({
  id: `m${n}`,
  jid: MARIA,
  body: `mensagem ${n}`,
  sender: 'Maria',
  from_me: 0,
  ts: 1_700_000_000 + n,
  ...fields,
});

async function openHistory() {
  const view = renderConnections('s1');
  await view.user.click(await screen.findByRole('tab', { name: 'Histórico' }));
  return view;
}

describe('WhatsApp history viewer', () => {
  it('filters chats, opens messages and pages back to older ones', async () => {
    const newest = Array.from({ length: 50 }, (_, i) => msg(i + 10, { from_me: i % 2 }));
    const api = fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/chats': (_body, url) =>
        chats.filter((c) => (c.name || c.jid).toLowerCase().includes(url.searchParams.get('q') || '')),
      'GET /sessions/s1/messages': (_body, url) =>
        url.searchParams.get('before') ? [msg(1, { body: 'a mais antiga' }), msg(2)] : newest,
    });
    const { user } = await openHistory();
    const list = await screen.findByRole('list', { name: 'Conversas do WhatsApp' });
    expect(await within(list).findByText('Maria')).toBeInTheDocument();
    expect(within(list).getByText('120363000000')).toBeInTheDocument();
    expect(within(list).getByText('Sem mensagens')).toBeInTheDocument();
    expect(screen.getByText('Selecione uma conversa para ver as mensagens.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar conversa'), 'mar');
    await waitFor(() => expect(within(list).queryByText('120363000000')).not.toBeInTheDocument());
    expect(api.calls.some((c) => c.path.endsWith('/chats') && c.search === '?q=mar')).toBe(true);

    await user.click(within(list).getByText('Maria'));
    const thread = await screen.findByRole('region', { name: 'Mensagens de Maria' });
    expect(await within(thread).findByText('mensagem 59')).toBeInTheDocument();
    const first = api.called('GET', '/sessions/s1/messages')[0];
    expect(new URLSearchParams(first.search).get('jid')).toBe(MARIA);
    expect(new URLSearchParams(first.search).get('limit')).toBe('50');

    await user.click(within(thread).getByRole('button', { name: 'Carregar anteriores' }));
    expect(await within(thread).findByText('a mais antiga')).toBeInTheDocument();
    const older = new URLSearchParams(api.called('GET', '/sessions/s1/messages')[1].search);
    expect(older.get('before')).toBe(String(1_700_000_010));
    expect(older.get('beforeId')).toBe('m10');
    expect(within(thread).queryByRole('button', { name: 'Carregar anteriores' })).not.toBeInTheDocument();
    const bodies = within(thread)
      .getAllByText(/^(mensagem \d+|a mais antiga)$/)
      .map((e) => e.textContent);
    expect(bodies.slice(0, 3)).toEqual(['a mais antiga', 'mensagem 2', 'mensagem 10']);
  });

  it('searches every message and opens the chat of a result', async () => {
    const api = fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/chats': chats,
      'GET /sessions/s1/search': [msg(5, { body: 'boleto vencido' }), msg(6, { jid: GROUP, body: 'boleto' })],
      'GET /sessions/s1/messages': (_body, url) =>
        url.searchParams.get('jid') === GROUP ? [] : [msg(5, { body: 'boleto vencido' })],
    });
    const { user } = await openHistory();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
    await user.type(screen.getByLabelText('Buscar em todas as mensagens'), ' boleto ');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const results = await screen.findByRole('region', { name: 'Resultados da busca' });
    expect(within(results).getByText('2 mensagens encontradas')).toBeInTheDocument();
    expect(api.called('GET', '/sessions/s1/search')[0].search).toBe('?q=boleto');

    await user.click(within(results).getByText('boleto'));
    const group = await screen.findByRole('region', { name: 'Mensagens de 120363000000' });
    expect(await within(group).findByText('Nenhuma mensagem sincronizada.')).toBeInTheDocument();
    await user.click(within(results).getByText('boleto vencido'));
    const maria = await screen.findByRole('region', { name: 'Mensagens de Maria' });
    expect(await within(maria).findByText('boleto vencido')).toBeInTheDocument();

    await user.click(within(results).getByRole('button', { name: 'Limpar busca' }));
    expect(screen.queryByRole('region', { name: 'Resultados da busca' })).not.toBeInTheDocument();
  });

  it('reports history failures', async () => {
    fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/chats': [],
      'GET /sessions/s1/search': () => {
        throw status(400, 'Busca inválida');
      },
    });
    const { user } = await openHistory();
    expect(await screen.findByText(/Nenhuma conversa\. Conecte o WhatsApp/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Buscar em todas as mensagens'), 'x');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Busca inválida');
  });

  it('reports message loading failures', async () => {
    let older = false;
    fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/chats': chats,
      'GET /sessions/s1/messages': () => {
        if (older) throw status(500, 'Histórico indisponível');
        older = true;
        return Array.from({ length: 50 }, (_, i) => msg(i + 1));
      },
    });
    const { user } = await openHistory();
    await user.click(await screen.findByText('Maria'));
    await user.click(await screen.findByRole('button', { name: 'Carregar anteriores' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Histórico indisponível');
  });
});
