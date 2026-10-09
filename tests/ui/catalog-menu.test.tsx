import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { connectRealtime } from '../../src/agent/api';
import { CatalogScreen } from '../../src/agent/catalog/CatalogScreen';
import type { User } from '../../src/agent/types';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, maria } from './fixtures';
import { burger, catalogRoutes, category, menu } from './catalog-fixtures';

function renderMenu(user: User = admin) {
  render(
    <CatalogScreen user={user} section="menu" realtime={connectRealtime(() => {})} onNavigate={vi.fn()} />,
  );
  return userEvent.setup();
}
const row = (name: string) => screen.getByRole('button', { name }).closest('li')!;
const firstLoad = { timeout: 5000 };

describe('catalog menu', () => {
  it('lists categories and items with price de/por, PDV code, photo and badges', async () => {
    fakeApi(catalogRoutes());
    const ui = renderMenu();
    expect(await screen.findByRole('button', { name: 'X-Burger' }, firstLoad)).toBeInTheDocument();
    const burgerRow = within(row('X-Burger'));
    expect(burgerRow.getByText('R$ 29,90')).toBeInTheDocument();
    expect(burgerRow.getByLabelText('Preço original')).toHaveTextContent('R$ 34,90');
    expect(burgerRow.getByText('PDV XB01')).toBeInTheDocument();
    expect(burgerRow.getByText('Obrigatório')).toBeInTheDocument();
    expect(burgerRow.getByRole('img', { name: 'X-Burger' })).toHaveAttribute(
      'src',
      '/api/v1/catalog/images/xb.jpg',
    );
    expect(within(row('Batata frita')).getByText('Pausado')).toBeInTheDocument();
    expect(within(row('Suco natural')).getByText('Fora do horário')).toBeInTheDocument();
    expect(within(row('Suco natural')).queryByText('Pausado')).not.toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Categorias' }));
    expect(
      within(nav.getByRole('button', { name: /^Combos/ }).closest('li')!).getByText('Pausada'),
    ).toBeInTheDocument();
    await ui.click(nav.getByRole('button', { name: /^Pizzas/ }));
    expect(await screen.findByText('a partir de R$ 49,90')).toBeInTheDocument();
    await ui.click(nav.getByRole('button', { name: /^Combos/ }));
    expect(screen.getByText('Nenhum item nesta categoria.')).toBeInTheDocument();
  });

  it('creates, edits, pauses, reorders and deletes categories', async () => {
    const api = fakeApi({
      ...catalogRoutes(),
      'POST /catalog/categories': category(4, 'Bebidas'),
      'PATCH /catalog/categories/1': category(1, 'Sanduíches'),
      'PATCH /catalog/categories/3': category(3, 'Combos'),
      'POST /catalog/categories/reorder': { ok: true },
      'DELETE /catalog/categories/1': () => {
        throw status(409, 'A categoria precisa estar vazia para ser excluída.');
      },
      'DELETE /catalog/categories/3': { ok: true },
    });
    const ui = renderMenu();
    await screen.findByRole('button', { name: 'X-Burger' }, firstLoad);

    await ui.click(screen.getByRole('button', { name: 'Nova categoria' }));
    const create = screen.getByRole('dialog', { name: 'Nova categoria' });
    await ui.type(within(create).getByLabelText('Nome da categoria'), 'Bebidas');
    await ui.type(within(create).getByLabelText('Descrição'), 'Geladas');
    await ui.selectOptions(within(create).getByLabelText('Modelo'), 'combo');
    await ui.type(within(create).getByLabelText('Código PDV'), 'BEB');
    await ui.click(within(create).getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/categories')[0].body).toEqual({
        name: 'Bebidas',
        description: 'Geladas',
        template: 'combo',
        external_code: 'BEB',
      }),
    );

    await ui.click(screen.getByRole('button', { name: 'Editar Lanches' }));
    const edit = screen.getByRole('dialog', { name: 'Editar categoria' });
    expect(within(edit).getByLabelText('Modelo')).toBeDisabled();
    await ui.clear(within(edit).getByLabelText('Nome da categoria'));
    await ui.type(within(edit).getByLabelText('Nome da categoria'), 'Sanduíches');
    await ui.click(within(edit).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/catalog/categories/1')[0].body).toMatchObject({ name: 'Sanduíches' }),
    );

    await ui.click(screen.getByRole('button', { name: 'Pausar Lanches' }));
    await ui.click(screen.getByRole('button', { name: 'Ativar Combos' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/catalog/categories/3')[0].body).toEqual({ status: 'available' }),
    );
    expect(api.called('PATCH', '/catalog/categories/1')[1].body).toEqual({ status: 'unavailable' });

    expect(screen.getByRole('button', { name: 'Mover Lanches para cima' })).toBeDisabled();
    await ui.click(screen.getByRole('button', { name: 'Mover Pizzas para cima' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/categories/reorder')[0].body).toEqual({ ids: [2, 1, 3] }),
    );

    await ui.click(screen.getByRole('button', { name: 'Excluir Lanches' }));
    const refuse = screen.getByRole('dialog', { name: 'Excluir categoria' });
    await ui.click(within(refuse).getByRole('button', { name: 'Sim, excluir' }));
    expect(await within(refuse).findByRole('alert')).toHaveTextContent('A categoria precisa estar vazia');
    await ui.click(within(refuse).getByRole('button', { name: 'Cancelar' }));
    await ui.click(screen.getByRole('button', { name: 'Excluir Combos' }));
    await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(api.called('DELETE', '/catalog/categories/3')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('pauses, duplicates, reorders and bulk-updates items', async () => {
    const api = fakeApi({
      ...catalogRoutes(),
      'PATCH /catalog/items/10': { ...burger, status: 'unavailable' },
      'POST /catalog/items/10/duplicate': { ...burger, id: 13 },
      'POST /catalog/items/reorder': { ok: true },
      'POST /catalog/items/status': { ok: true },
    });
    const ui = renderMenu();
    await screen.findByRole('button', { name: 'X-Burger' }, firstLoad);

    await ui.click(screen.getByRole('switch', { name: 'Disponível: X-Burger' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/catalog/items/10')[0].body).toEqual({ status: 'unavailable' }),
    );
    await ui.click(screen.getByRole('switch', { name: 'Disponível: Batata frita' }));
    await ui.click(screen.getByRole('button', { name: 'Duplicar X-Burger' }));
    await waitFor(() => expect(api.called('POST', '/catalog/items/10/duplicate')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Mover Suco natural para baixo' })).toBeDisabled();
    await ui.click(screen.getByRole('button', { name: 'Mover Batata frita para cima' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/items/reorder')[0].body).toEqual({
        category_id: 1,
        ids: [11, 10, 12],
      }),
    );

    await ui.click(screen.getByRole('checkbox', { name: 'Selecionar X-Burger' }));
    await ui.click(screen.getByRole('checkbox', { name: 'Selecionar Batata frita' }));
    const bar = within(screen.getByRole('toolbar', { name: 'Ações em massa' }));
    expect(bar.getByText('2 itens selecionados')).toBeInTheDocument();
    await ui.click(bar.getByRole('button', { name: 'Pausar' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/items/status')[0].body).toEqual({
        ids: [10, 11],
        status: 'unavailable',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument());
    await ui.click(screen.getByRole('checkbox', { name: 'Selecionar Suco natural' }));
    expect(screen.getByText('1 item selecionado')).toBeInTheDocument();
    await ui.click(screen.getByRole('button', { name: 'Ativar' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/items/status')[1].body).toEqual({ ids: [12], status: 'available' }),
    );
    await ui.click(screen.getByRole('checkbox', { name: 'Selecionar Suco natural' }));
    await ui.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(api.called('GET', '/catalog').length).toBeGreaterThan(3);
  });

  it('searches, filters by status, refreshes on catalog.updated and reports errors', async () => {
    const api = fakeApi({
      ...catalogRoutes(),
      'GET /catalog/search': [burger],
      'PATCH /catalog/items/10': () => {
        throw status(403, 'Sem permissão');
      },
    });
    const ui = renderMenu();
    await screen.findByRole('button', { name: 'X-Burger' }, firstLoad);

    await ui.type(screen.getByLabelText('Buscar itens por nome ou código…'), 'bur');
    expect(await screen.findByRole('heading', { name: 'Resultados para “bur”' })).toBeInTheDocument();
    await waitFor(() => expect(api.called('GET', '/catalog/search').at(-1)!.search).toBe('?q=bur'));
    expect(screen.queryByRole('button', { name: 'Batata frita' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mover X-Burger/ })).not.toBeInTheDocument();
    await ui.clear(screen.getByLabelText('Buscar itens por nome ou código…'));

    const filter = screen.getByLabelText('Filtrar por status');
    await ui.selectOptions(filter, 'unavailable');
    expect(await screen.findByRole('button', { name: 'Batata frita' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'X-Burger' })).not.toBeInTheDocument();
    await ui.selectOptions(filter, 'off_hours');
    expect(screen.getByRole('button', { name: 'Suco natural' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Batata frita' })).not.toBeInTheDocument();
    await ui.selectOptions(filter, 'available');
    expect(screen.getByRole('button', { name: 'X-Burger' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suco natural' })).not.toBeInTheDocument();

    await ui.click(screen.getByRole('switch', { name: 'Disponível: X-Burger' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');

    const renamed = {
      ...menu,
      categories: [
        { ...menu.categories[0], items: [{ ...burger, product: { ...burger.product, name: 'X-Tudo' } }] },
      ],
    };
    api.route('GET /catalog', renamed);
    FakeEventSource.emit('catalog.updated', {});
    expect(await screen.findByRole('button', { name: 'X-Tudo' })).toBeInTheDocument();
  });

  it('gives agents a read-only menu', async () => {
    fakeApi(catalogRoutes());
    const ui = renderMenu(maria);
    await screen.findByRole('button', { name: 'X-Burger' }, firstLoad);
    expect(screen.getByText(/Somente administradores podem alterar o cardápio/)).toBeInTheDocument();
    for (const name of ['Nova categoria', 'Novo item', 'Editar Lanches', 'Duplicar X-Burger'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await ui.click(screen.getByRole('button', { name: 'X-Burger' }));
    const panel = screen.getByRole('dialog', { name: 'X-Burger' });
    expect(within(panel).getByLabelText('Nome do item')).toBeDisabled();
    expect(within(panel).getByLabelText('Mínimo de Escolha a bebida')).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: 'Salvar item' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Enviar foto' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: 'Simulador' })).toBeInTheDocument();
    await ui.click(within(panel).getAllByRole('button', { name: 'Fechar' }).at(-1)!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
