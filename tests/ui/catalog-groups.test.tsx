import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogScreen } from '../../src/agent/catalog/CatalogScreen';
import type { User } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, maria } from './fixtures';
import { catalogRoutes, extras, group } from './catalog-fixtures';

async function renderLibrary(user: User = admin) {
  const ui = userEvent.setup();
  render(<CatalogScreen user={user} section="groups" onNavigate={vi.fn()} />);
  await screen.findByText('Escolha a bebida', {}, { timeout: 5000 });
  return ui;
}
const rowOf = (name: string) => within(screen.getByText(name).closest('tr')!);

describe('complements library', () => {
  it('lists groups with type, options, prices and usage, and filters by name', async () => {
    fakeApi(catalogRoutes());
    const ui = await renderLibrary();
    expect(screen.getByText('7 grupos')).toBeInTheDocument();
    const drinks = rowOf('Escolha a bebida');
    expect(drinks.getByText('Escolha de produtos')).toBeInTheDocument();
    expect(drinks.getByText('Coca-Cola (+R$ 6,00), Guaraná (+R$ 5,00)')).toBeInTheDocument();
    expect(drinks.getByText('1 item')).toBeInTheDocument();
    expect(rowOf('Adicionais').getByText('2 itens')).toBeInTheDocument();
    await ui.type(screen.getByLabelText('Pesquisar grupos…'), 'adic');
    expect(screen.queryByText('Escolha a bebida')).not.toBeInTheDocument();
    await ui.clear(screen.getByLabelText('Pesquisar grupos…'));
    await ui.type(screen.getByLabelText('Pesquisar grupos…'), 'zzz');
    expect(screen.getByText('Nenhum grupo de complementos.')).toBeInTheDocument();
  });

  it('creates a group with validated options', async () => {
    const api = fakeApi({ ...catalogRoutes(), 'POST /catalog/groups': group(9, 'Bebidas') });
    const ui = await renderLibrary();
    await ui.click(screen.getByRole('button', { name: 'Novo grupo' }));
    const panel = screen.getByRole('dialog', { name: 'Novo grupo de complementos' });
    const p = within(panel);
    await ui.click(p.getByRole('button', { name: 'Salvar grupo' }));
    expect(p.getByRole('alert')).toHaveTextContent('Informe o nome do grupo.');
    expect(p.getByRole('alert')).toHaveTextContent('Opção 1: informe o nome.');

    await ui.type(p.getByLabelText('Nome do grupo'), 'Bebidas');
    await ui.selectOptions(p.getByLabelText('Tipo'), 'offer_unit');
    await ui.type(p.getByLabelText('Código PDV'), 'BEB');
    await ui.type(p.getByLabelText('Nome da opção 1'), 'Água');
    await ui.type(p.getByLabelText('Preço da opção 1'), '3,50');
    await ui.type(p.getByLabelText('Código PDV da opção 1'), 'AGUA');
    await ui.clear(p.getByLabelText('Quantidade máxima da opção 1'));
    await ui.type(p.getByLabelText('Quantidade máxima da opção 1'), '2');
    await ui.click(p.getByRole('button', { name: 'Adicionar opção' }));
    await ui.type(p.getByLabelText('Nome da opção 2'), 'Suco');
    await ui.type(p.getByLabelText('Preço da opção 2'), '6,00');
    await ui.click(p.getByRole('switch', { name: 'Opção 2 disponível' }));
    await ui.click(p.getByRole('button', { name: 'Subir opção 2' }));
    expect(p.getByLabelText('Nome da opção 1')).toHaveValue('Suco');
    await ui.click(p.getByRole('button', { name: 'Adicionar opção' }));
    await ui.click(p.getByRole('button', { name: 'Remover opção 3' }));
    await ui.click(p.getByRole('button', { name: 'Salvar grupo' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/groups')[0].body).toEqual({
        name: 'Bebidas',
        type: 'offer_unit',
        external_code: 'BEB',
        status: 'available',
        options: [
          {
            product: { name: 'Suco' },
            price_cents: 600,
            original_price_cents: null,
            status: 'unavailable',
            external_code: null,
            max_quantity: 1,
            position: 0,
          },
          {
            product: { name: 'Água' },
            price_cents: 350,
            original_price_cents: null,
            status: 'available',
            external_code: 'AGUA',
            max_quantity: 2,
            position: 1,
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits options of a group and explains why a group in use cannot be deleted', async () => {
    const api = fakeApi({
      ...catalogRoutes(),
      'PATCH /catalog/groups/2': extras,
      'DELETE /catalog/groups/2': () => {
        throw status(409, 'Grupo em uso');
      },
      'DELETE /catalog/groups/3': { ok: true },
    });
    const ui = await renderLibrary();
    await ui.click(screen.getByRole('button', { name: 'Editar Adicionais' }));
    const p = within(screen.getByRole('dialog', { name: 'Adicionais' }));
    expect(p.getByLabelText('Nome da opção 1')).toHaveValue('Bacon');
    expect(p.getAllByRole('button', { name: 'Enviar foto' })).toHaveLength(2);
    await ui.clear(p.getByLabelText('Quantidade máxima da opção 1'));
    await ui.click(p.getByRole('button', { name: 'Salvar grupo' }));
    expect(p.getByRole('alert')).toHaveTextContent('Opção 1: a quantidade máxima deve ser pelo menos 1.');
    await ui.type(p.getByLabelText('Quantidade máxima da opção 1'), '5');
    await ui.selectOptions(p.getByLabelText('Status'), 'unavailable');
    await ui.click(p.getByRole('button', { name: 'Descer opção 1' }));
    await ui.click(p.getByRole('button', { name: 'Salvar grupo' }));
    await waitFor(() => expect(api.called('PATCH', '/catalog/groups/2')).toHaveLength(1));
    expect(api.called('PATCH', '/catalog/groups/2')[0].body).toMatchObject({
      status: 'unavailable',
      options: [
        { id: 22, product: { name: 'Cheddar' }, position: 0 },
        { id: 21, product: { name: 'Bacon' }, max_quantity: 5, position: 1 },
      ],
    });

    await ui.click(await screen.findByRole('button', { name: 'Excluir Adicionais' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Excluir grupo' }));
    expect(confirm.getByText('Excluir “Adicionais”? Ele está em 2 itens.')).toBeInTheDocument();
    await ui.click(confirm.getByRole('button', { name: 'Sim, excluir' }));
    expect(await confirm.findByRole('alert')).toHaveTextContent(
      'Este grupo está em uso em 2 itens. Remova-o dos itens antes de excluir.',
    );
    await ui.click(confirm.getByRole('button', { name: 'Cancelar' }));
    await ui.click(screen.getByRole('button', { name: 'Excluir Molhos' }));
    await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(api.called('DELETE', '/catalog/groups/3')).toHaveLength(1));
  });

  it('reports other delete failures and lets agents only view groups', async () => {
    fakeApi({
      ...catalogRoutes(),
      'DELETE /catalog/groups/3': () => {
        throw status(500, 'Falha ao excluir');
      },
    });
    const ui = await renderLibrary();
    await ui.click(screen.getByRole('button', { name: 'Excluir Molhos' }));
    await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, excluir' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Falha ao excluir',
    );
  });

  it('shows the library read-only to agents', async () => {
    fakeApi(catalogRoutes());
    const ui = await renderLibrary(maria);
    expect(screen.queryByRole('button', { name: 'Novo grupo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir Adicionais' })).not.toBeInTheDocument();
    await ui.click(screen.getByRole('button', { name: 'Ver Adicionais' }));
    const p = within(screen.getByRole('dialog', { name: 'Adicionais' }));
    expect(p.getByLabelText('Nome do grupo')).toBeDisabled();
    expect(p.queryByRole('button', { name: 'Salvar grupo' })).not.toBeInTheDocument();
    expect(p.queryByRole('button', { name: 'Enviar foto' })).not.toBeInTheDocument();
    await ui.click(p.getAllByRole('button', { name: 'Fechar' }).at(-1)!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
