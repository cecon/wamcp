import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LabelsPage } from '../../src/agent/settings/LabelsPage';
import type { Catalog } from '../../src/agent/types';
import { fakeApi } from './fake-api';

const CATALOG: Catalog = {
  inboxes: [],
  agents: [],
  teams: [],
  labels: [
    { id: 1, title: 'vip', description: 'Clientes VIP', color: '#2781F6' },
    { id: 2, title: 'financeiro', description: null, color: '#E54666' },
  ],
};

describe('Etiquetas no C3Theme (tela piloto)', () => {
  it('lista, busca, cria e exclui mantendo os contratos da tela antiga', async () => {
    const api = fakeApi({
      'POST /labels': (body) => ({ id: 3, ...(body as object) }),
      'DELETE /labels/1': { ok: true },
    });
    const onChange = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<LabelsPage catalog={CATALOG} onChange={onChange} />);

    // O chunk do MUI carrega no import da página; em paralelo a primeira transformação passa de 1 s.
    expect(await screen.findByRole('heading', { name: 'Etiquetas' }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText('vip')).toBeInTheDocument();
    expect(screen.getByText('2 etiquetas')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Pesquisar etiquetas…'), 'fin');
    expect(screen.queryByText('vip')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Pesquisar etiquetas…'));

    await user.click(screen.getByRole('button', { name: 'Adicionar etiqueta' }));
    await user.type(await screen.findByLabelText(/Nome da etiqueta/), 'novo');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(api.called('POST', '/labels')).toHaveLength(1));
    expect(onChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Excluir vip' }));
    await waitFor(() => expect(api.called('DELETE', '/labels/1')).toHaveLength(1));
  });
});
