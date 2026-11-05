import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CannedPage } from '../../src/agent/settings/CannedPage';
import { fakeApi } from './fake-api';

const ITEMS = [{ id: 1, short_code: 'saudacao', content: 'Olá! Como posso ajudar?' }];

describe('Respostas prontas no C3Theme (lote 2)', () => {
  it('lista, busca, cria e exclui mantendo os contratos da tela antiga', async () => {
    const api = fakeApi({
      'GET /canned_responses': ITEMS,
      'POST /canned_responses': (body) => ({ id: 2, ...(body as object) }),
      'DELETE /canned_responses/1': { ok: true },
    });
    const user = userEvent.setup();
    render(<CannedPage />);

    expect(
      await screen.findByRole('heading', { name: 'Respostas prontas' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('/saudacao')).toBeInTheDocument();
    expect(screen.getByText('Olá! Como posso ajudar?')).toBeInTheDocument();
    expect(screen.getByText('1 resposta')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Pesquisar respostas…'), 'zzz');
    expect(await screen.findByText('Nenhuma resposta pronta ainda.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Pesquisar respostas…'));

    await user.click(screen.getByRole('button', { name: 'Adicionar resposta pronta' }));
    await user.type(await screen.findByLabelText(/Atalho/), 'novo');
    await user.type(screen.getByLabelText(/Mensagem/), 'Mensagem nova');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.called('POST', '/canned_responses')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Excluir /saudacao' }));
    await waitFor(() => expect(api.called('DELETE', '/canned_responses/1')).toHaveLength(1));
  });
});
