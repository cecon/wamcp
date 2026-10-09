import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { McpToken } from '../../src/agent/settings/connections/model';
import { fakeApi, status } from './fake-api';
import { connected, renderConnections } from './connection-harness';

async function openTab(name: string) {
  const view = renderConnections('s1');
  await view.user.click(await screen.findByRole('tab', { name }));
  return view;
}

describe('MCP access tokens', () => {
  it('shows the MCP address, creates a token shown once and revokes tokens', async () => {
    let tokens: McpToken[] = [
      { id: 't1', name: 'Claude', scope: 'read', expires: '2027-01-01T12:00:00Z', last_used: null },
    ];
    const api = fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/tokens': () => tokens,
      'POST /sessions/s1/tokens': (body) => {
        const created = { ...(body as McpToken), id: 't2', expires: '2027-02-01T12:00:00Z' };
        tokens = [...tokens, { ...created, last_used: '2026-10-01T12:00:00Z' }];
        return { ...created, token: 'wamcp_segredo' };
      },
      'DELETE /sessions/s1/tokens/t2': () => {
        tokens = tokens.filter((t) => t.id !== 't2');
        return { ok: true };
      },
    });
    const { user } = await openTab('Acesso MCP');
    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço MCP desta conexão')).toHaveValue(connected.mcpUrl);
    expect(screen.getByText(/Somente leitura · Expira em/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copiar endereço MCP' }));
    expect(await navigator.clipboard.readText()).toBe(connected.mcpUrl);

    await user.type(screen.getByLabelText('Nome da integração'), 'Cursor');
    await user.selectOptions(screen.getByLabelText('Permissão'), 'read_write');
    await user.selectOptions(screen.getByLabelText('Validade'), '30');
    await user.click(screen.getByRole('button', { name: 'Gerar token' }));
    expect(await screen.findByText('Copie agora. Este token só aparece uma vez.')).toBeInTheDocument();
    expect(screen.getByLabelText('Token de acesso')).toHaveValue('wamcp_segredo');
    expect(screen.getByLabelText('Configuração MCP')).toHaveTextContent('Bearer wamcp_segredo');
    expect(api.called('POST', '/sessions/s1/tokens')[0].body).toEqual({
      name: 'Cursor',
      scope: 'read_write',
      days: 30,
    });
    expect(await screen.findByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText(/Leitura e envio · Expira em .* · Último uso/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da integração')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Revogar Cursor' }));
    const dialog = screen.getByRole('dialog', { name: 'Revogar Cursor?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(screen.queryByText('Cursor')).not.toBeInTheDocument());
    expect(api.called('DELETE', '/sessions/s1/tokens/t2')).toHaveLength(1);
    expect(screen.queryByText('Copie agora. Este token só aparece uma vez.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Configuração MCP')).toHaveTextContent('Bearer SEU_TOKEN');
  });

  it('hides a fresh token on request and shows creation errors', async () => {
    let fail = false;
    fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/tokens': [],
      'POST /sessions/s1/tokens': () => {
        if (fail) throw status(400, 'Nome inválido');
        return { id: 't3', name: 'A', scope: 'read', expires: '2027-01-01T00:00:00Z', token: 'wamcp_x' };
      },
    });
    const { user } = await openTab('Acesso MCP');
    expect(await screen.findByText('Nenhum token criado para esta conexão.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome da integração'), 'A');
    await user.click(screen.getByRole('button', { name: 'Gerar token' }));
    await user.click(await screen.findByRole('button', { name: 'Já copiei, ocultar token' }));
    expect(screen.queryByLabelText('Token de acesso')).not.toBeInTheDocument();
    fail = true;
    await user.type(screen.getByLabelText('Nome da integração'), 'B');
    await user.click(screen.getByRole('button', { name: 'Gerar token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nome inválido');
  });
});

describe('ChatGPT connection', () => {
  it('generates a one-time code and disconnects authorized grants', async () => {
    let grants = [{ id: 'g1', name: 'ChatGPT', scope: 'read_write', expires: '2027-01-01T00:00:00Z' }];
    const api = fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/chatgpt': () => grants,
      'POST /sessions/s1/chatgpt/link': { code: 'codigo-unico', expires: '2026-10-08T12:10:00Z' },
      'DELETE /sessions/s1/chatgpt/g1': () => {
        grants = [];
        return { ok: true };
      },
    });
    const { user } = await openTab('ChatGPT');
    expect(await screen.findByText('Leitura e envio · Até', { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText('URL do servidor MCP para o ChatGPT')).toHaveValue(connected.mcpUrl);
    await user.selectOptions(screen.getByLabelText('Permissão do ChatGPT'), 'read_write');
    await user.click(screen.getByRole('button', { name: 'Gerar código para o ChatGPT' }));
    expect(await screen.findByLabelText('Código para o ChatGPT')).toHaveValue('codigo-unico');
    expect(api.called('POST', '/sessions/s1/chatgpt/link')[0].body).toEqual({ scope: 'read_write' });
    await user.click(screen.getByRole('button', { name: 'Ocultar código' }));
    expect(screen.queryByLabelText('Código para o ChatGPT')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desconectar ChatGPT' }));
    const dialog = screen.getByRole('dialog', { name: 'Desconectar ChatGPT?' });
    await user.click(within(dialog).getByRole('button', { name: 'Desconectar' }));
    expect(await screen.findByText('Nenhuma conexão do ChatGPT autorizada.')).toBeInTheDocument();
    expect(api.called('DELETE', '/sessions/s1/chatgpt/g1')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(api.called('GET', '/sessions/s1/chatgpt').length).toBeGreaterThan(2));
  });

  it('explains when the code cannot be generated', async () => {
    fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/chatgpt': [],
      'POST /sessions/s1/chatgpt/link': () => {
        throw status(400, 'OAuth indisponível');
      },
    });
    const { user } = await openTab('ChatGPT');
    await user.click(await screen.findByRole('button', { name: 'Gerar código para o ChatGPT' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('OAuth indisponível');
  });
});

describe('MCP activity', () => {
  it('lists the audit trail of the connection', async () => {
    fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/audit': [
        { action: 'send_message', at: '2026-10-08T10:00:00Z', token_id: 't1' },
        { action: 'list_chats', at: '2026-10-08T09:00:00Z', token_id: null },
      ],
    });
    await openTab('Atividade');
    expect(await screen.findByText('send_message')).toBeInTheDocument();
    expect(screen.getByText('t1')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the empty state and load errors', async () => {
    fakeApi({ 'GET /sessions/s1': connected, 'GET /sessions/s1/audit': [] });
    const { user } = await openTab('Atividade');
    expect(await screen.findByText('As chamadas MCP aparecerão aqui.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Conexão' }));
    expect(await screen.findByText('Tudo conectado')).toBeInTheDocument();
  });

  it('reports audit failures', async () => {
    fakeApi({
      'GET /sessions/s1': connected,
      'GET /sessions/s1/audit': () => {
        throw status(500, 'Falha no registro');
      },
    });
    await openTab('Atividade');
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha no registro');
  });
});
