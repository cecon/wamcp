import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogScreen } from '../../src/agent/catalog/CatalogScreen';
import { fakeApi } from './fake-api';
import { admin } from './fixtures';
import { calabresa, catalogRoutes, crusts, edges, group, option, sizes, toppings } from './catalog-fixtures';

async function openCategory(name: string) {
  const ui = userEvent.setup();
  render(<CatalogScreen user={admin} section="menu" onNavigate={vi.fn()} />);
  await ui.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }, { timeout: 5000 }));
  return ui;
}
const errors = (panel: HTMLElement) => within(panel).getByRole('alert').textContent;

describe('pizza editor', () => {
  it('edits sizes, crusts, edges and the flavor price grid, saving groups before the item', async () => {
    const family = option(53, 'Família', 7990, { fractions: [1, 2, 3], position: 2 });
    const api = fakeApi({
      ...catalogRoutes(),
      'PATCH /catalog/groups/5': { ...sizes, options: [...sizes.options, family] },
      'PATCH /catalog/groups/6': crusts,
      'PATCH /catalog/groups/7': edges,
      'PATCH /catalog/groups/8': toppings,
      'PATCH /catalog/items/20': calabresa,
    });
    const ui = await openCategory('Pizzas');
    await ui.click(await screen.findByRole('button', { name: 'Calabresa' }));
    const panel = screen.getByRole('dialog', { name: 'Editar Calabresa' });
    const p = within(panel);
    expect(p.getByText('O preço da pizza vem do tamanho e dos sabores escolhidos.')).toBeInTheDocument();
    expect(p.queryByLabelText('Preço')).not.toBeInTheDocument();
    expect(p.getByLabelText('Nome do tamanho 1')).toHaveValue('Média');
    expect(p.getByLabelText('Preço base do tamanho 2')).toHaveValue('59,90');
    expect(p.getByLabelText('Fatias do tamanho 2')).toHaveValue(8);
    expect(
      within(p.getByRole('group', { name: 'Tamanho 2' })).getByText('1 ou 2 sabores'),
    ).toBeInTheDocument();
    expect(p.getByLabelText('Preço de Calabresa (Grande)')).toHaveValue('5,00');
    expect(p.getByLabelText('Borda 1')).toHaveValue('Catupiry');
    expect(p.getByLabelText('Acréscimo de borda 1')).toHaveValue('8,00');
    expect(p.queryByRole('listitem', { name: 'Tamanho' })).not.toBeInTheDocument();

    await ui.click(p.getByRole('button', { name: 'Adicionar tamanho' }));
    await ui.type(p.getByLabelText('Nome do tamanho 3'), 'Família');
    await ui.type(p.getByLabelText('Preço base do tamanho 3'), '79,90');
    await ui.click(p.getByRole('checkbox', { name: 'Tamanho 3 aceita 2 sabores' }));
    await ui.click(p.getByRole('checkbox', { name: 'Tamanho 3 aceita 3 sabores' }));
    expect(
      within(p.getByRole('group', { name: 'Tamanho 3' })).getByText('1, 2 ou 3 sabores'),
    ).toBeInTheDocument();
    await ui.click(p.getByRole('button', { name: 'Salvar item' }));
    expect(errors(panel)).toContain('Informe o preço do sabor “Calabresa” em todos os tamanhos.');

    await ui.type(p.getByLabelText('Preço de Calabresa (Família)'), '10,00');
    await ui.click(p.getByRole('button', { name: 'Adicionar sabor' }));
    await ui.type(p.getByLabelText('Sabor 2'), 'Mussarela');
    await ui.type(p.getByLabelText('Preço de Mussarela (Média)'), '0');
    await ui.type(p.getByLabelText('Preço de Mussarela (Grande)'), '3,00');
    await ui.type(p.getByLabelText('Preço de Mussarela (Família)'), '6,00');
    await ui.click(p.getByRole('button', { name: 'Adicionar borda' }));
    await ui.type(p.getByLabelText('Borda 2'), 'Cheddar');
    await ui.type(p.getByLabelText('Acréscimo de borda 2'), '9,00');
    await ui.click(p.getByRole('button', { name: 'Adicionar massa' }));
    await ui.click(p.getByRole('button', { name: 'Remover massa 2' }));
    await ui.click(p.getByRole('button', { name: 'Salvar item' }));

    await waitFor(() => expect(api.called('PATCH', '/catalog/items/20')).toHaveLength(1));
    const order = api.calls.filter((c) => c.method === 'PATCH').map((c) => c.path.replace('/api/v1', ''));
    expect(order).toEqual([
      '/catalog/groups/5',
      '/catalog/groups/6',
      '/catalog/groups/7',
      '/catalog/groups/8',
      '/catalog/items/20',
    ]);
    const sizeBody = api.called('PATCH', '/catalog/groups/5')[0].body as { options: object[] };
    expect(sizeBody).toMatchObject({ name: 'Tamanho', type: 'size' });
    expect(sizeBody.options[0]).toMatchObject({
      id: 51,
      product: { name: 'Média', slices: 6 },
      fractions: [1],
    });
    expect(sizeBody.options[2]).toEqual({
      product: { name: 'Família', slices: null },
      price_cents: 7990,
      original_price_cents: null,
      status: 'available',
      external_code: null,
      max_quantity: 1,
      fractions: [1, 2, 3],
      position: 2,
    });
    const flavors = api.called('PATCH', '/catalog/groups/8')[0].body as { options: object[] };
    expect(flavors.options[1]).toMatchObject({
      product: { name: 'Mussarela' },
      size_prices: [
        { size_option_id: 51, price_cents: 0 },
        { size_option_id: 52, price_cents: 300 },
        { size_option_id: 53, price_cents: 600 },
      ],
    });
    expect(api.called('PATCH', '/catalog/groups/7')[0].body).toMatchObject({
      options: [
        { id: 71, price_cents: 800 },
        { product: { name: 'Cheddar' }, price_cents: 900 },
      ],
    });
    expect(api.called('PATCH', '/catalog/items/20')[0].body).toMatchObject({
      price_cents: 0,
      original_price_cents: null,
      groups: [
        { group_id: 5, min: 1, max: 1, position: 0 },
        { group_id: 6, min: 1, max: 1, position: 1 },
        { group_id: 7, min: 0, max: 1, position: 2 },
        { group_id: 8, min: 1, max: 3, position: 3 },
      ],
    });
  });

  it('creates a pizza reusing the category groups and checks sizes and flavors', async () => {
    const api = fakeApi({
      ...catalogRoutes(),
      'PATCH /catalog/groups/5': sizes,
      'PATCH /catalog/groups/6': crusts,
      'PATCH /catalog/groups/7': edges,
      'PATCH /catalog/groups/8': toppings,
      'POST /catalog/items': calabresa,
    });
    const ui = await openCategory('Pizzas');
    await ui.click(await screen.findByRole('button', { name: 'Novo item' }));
    const panel = screen.getByRole('dialog', { name: 'Novo item' });
    const p = within(panel);
    await ui.type(p.getByLabelText('Nome do item'), 'Portuguesa');
    await ui.click(p.getByRole('button', { name: 'Remover tamanho 1' }));
    expect(p.getByLabelText('Nome do tamanho 1')).toHaveValue('Grande');
    expect(p.queryByLabelText('Preço de Calabresa (Média)')).not.toBeInTheDocument();
    await ui.click(p.getByRole('checkbox', { name: 'Tamanho 1 aceita 1 sabor' }));
    await ui.click(p.getByRole('checkbox', { name: 'Tamanho 1 aceita 2 sabores' }));
    expect(p.getByText('nenhum sabor')).toBeInTheDocument();
    await ui.click(p.getByRole('button', { name: 'Adicionar sabor' }));
    await ui.click(p.getByRole('button', { name: 'Adicionar borda' }));
    await ui.click(p.getByRole('button', { name: 'Criar item' }));
    const problems = errors(panel);
    expect(problems).toContain('Cada tamanho precisa aceitar pelo menos 1 sabor.');
    expect(problems).toContain('Todo sabor precisa de um nome.');
    expect(problems).toContain('Massas e bordas precisam de nome.');

    await ui.click(p.getByRole('button', { name: 'Remover sabor 2' }));
    await ui.click(p.getByRole('button', { name: 'Remover borda 2' }));
    await ui.click(p.getByRole('checkbox', { name: 'Tamanho 1 aceita 1 sabor' }));
    await ui.click(p.getByRole('button', { name: 'Remover borda 1' }));
    await ui.click(p.getByRole('button', { name: 'Criar item' }));
    await waitFor(() => expect(api.called('POST', '/catalog/items')).toHaveLength(1));
    expect(api.called('PATCH', '/catalog/groups/7')).toHaveLength(0);
    expect(api.called('POST', '/catalog/items')[0].body).toMatchObject({
      category_id: 2,
      type: 'pizza',
      product: { name: 'Portuguesa' },
      groups: [
        { group_id: 5, min: 1, max: 1, position: 0 },
        { group_id: 6, min: 1, max: 1, position: 1 },
        { group_id: 8, min: 1, max: 1, position: 2 },
      ],
    });
  });

  it('builds a combo from menu items with surcharges', async () => {
    const main = group(40, 'Escolha o item principal', { type: 'combo_main' });
    const api = fakeApi({
      ...catalogRoutes(),
      'POST /catalog/groups': main,
      'POST /catalog/items': calabresa,
    });
    const ui = await openCategory('Combos');
    await ui.click(screen.getByRole('button', { name: 'Novo item' }));
    const panel = screen.getByRole('dialog', { name: 'Novo item' });
    const p = within(panel);
    expect(p.getByText('Nenhum item no combo.')).toBeInTheDocument();
    await ui.type(p.getByLabelText('Nome do item'), 'Combo X');
    await ui.type(p.getByLabelText('Preço'), '39,90');
    await ui.click(p.getByRole('button', { name: 'Criar item' }));
    expect(errors(panel)).toContain('Escolha pelo menos um item para o combo.');
    expect(
      within(p.getByLabelText('Item do cardápio')).queryByRole('option', { name: 'Combo X' }),
    ).toBeNull();

    await ui.selectOptions(p.getByLabelText('Item do cardápio'), 'X-Burger');
    await ui.click(p.getByRole('button', { name: 'Adicionar ao combo' }));
    expect(p.getByText('(R$ 29,90 avulso)')).toBeInTheDocument();
    await ui.type(p.getByLabelText('Acréscimo de X-Burger'), '5,00');
    await ui.selectOptions(p.getByLabelText('Item do cardápio'), 'Batata frita');
    await ui.click(p.getByRole('button', { name: 'Adicionar ao combo' }));
    await ui.click(p.getByRole('button', { name: 'Remover Batata frita do combo' }));
    await ui.click(p.getByRole('button', { name: 'Criar item' }));
    await waitFor(() => expect(api.called('POST', '/catalog/items')).toHaveLength(1));
    expect(api.called('POST', '/catalog/groups')[0].body).toEqual({
      name: 'Escolha o item principal',
      type: 'combo_main',
      external_code: null,
      status: 'available',
      options: [
        {
          product: { name: 'X-Burger' },
          price_cents: 500,
          original_price_cents: null,
          status: 'available',
          external_code: null,
          max_quantity: 1,
          item_id: 10,
          position: 0,
        },
      ],
    });
    expect(api.called('POST', '/catalog/items')[0].body).toMatchObject({
      category_id: 3,
      type: 'combo',
      price_cents: 3990,
      groups: [{ group_id: 40, min: 1, max: 1, position: 0 }],
    });
  });
});
