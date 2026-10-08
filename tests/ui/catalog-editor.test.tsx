import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogScreen } from '../../src/agent/catalog/CatalogScreen';
import { fakeApi, status } from './fake-api';
import { admin } from './fixtures';
import { burger, catalogRoutes, group, option, product } from './catalog-fixtures';

async function openEditor(name: string) {
  const ui = userEvent.setup({ applyAccept: false });
  render(<CatalogScreen user={admin} section="menu" onNavigate={vi.fn()} />);
  await ui.click(await screen.findByRole('button', { name }, { timeout: 5000 }));
  return ui;
}
const errorList = (panel: HTMLElement) =>
  within(panel)
    .getAllByRole('alert')
    .map((a) => a.textContent)
    .join(' ');

describe('item editor', () => {
  it('validates and creates an item with shifts, dietary tags and complements', async () => {
    const api = fakeApi({ ...catalogRoutes(), 'POST /catalog/items': { ...burger, id: 14 } });
    const ui = await openEditor('Novo item');
    const panel = screen.getByRole('dialog', { name: 'Novo item' });
    expect(within(panel).getByText('Salve o item para adicionar uma foto.')).toBeInTheDocument();
    expect(within(panel).getByText(/Sempre disponível/)).toBeInTheDocument();
    await ui.click(within(panel).getByRole('button', { name: 'Criar item' }));
    expect(errorList(panel)).toContain('Informe o nome do item.');

    await ui.type(within(panel).getByLabelText('Nome do item'), 'Hambúrguer duplo');
    await ui.type(within(panel).getByLabelText('Descrição'), 'Dois discos');
    await ui.type(within(panel).getByLabelText('Código PDV'), 'HD01');
    await ui.type(within(panel).getByLabelText('EAN'), 'abc');
    await ui.selectOptions(within(panel).getByLabelText('Serve'), 'serves_2');
    await ui.click(within(panel).getByRole('button', { name: 'Vegetariano' }));
    expect(within(panel).getByRole('button', { name: 'Vegetariano' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await ui.click(within(panel).getByRole('button', { name: 'Sem glúten' }));
    await ui.click(within(panel).getByRole('button', { name: 'Sem glúten' }));
    await ui.type(within(panel).getByLabelText('Preço'), '25,00');
    await ui.type(within(panel).getByLabelText('Preço “de” (promoção)'), '20,00');

    await ui.click(within(panel).getByRole('button', { name: 'Adicionar horário' }));
    const shift = within(within(panel).getByRole('group', { name: 'Horário 1' }));
    fireEvent.change(shift.getByLabelText('Fim do horário 1'), { target: { value: '11:00' } });
    await ui.click(shift.getByRole('checkbox', { name: 'Dom' }));

    const library = within(panel).getByLabelText('Grupo da biblioteca');
    expect(within(library).queryByRole('option', { name: 'Tamanho' })).not.toBeInTheDocument();
    await ui.selectOptions(library, 'Escolha a bebida');
    await ui.click(within(panel).getByRole('button', { name: 'Vincular' }));
    const link = within(within(panel).getByRole('listitem', { name: 'Escolha a bebida' }));
    expect(link.getByText('Opcional')).toBeInTheDocument();
    await ui.clear(link.getByLabelText('Mínimo de Escolha a bebida'));
    await ui.type(link.getByLabelText('Mínimo de Escolha a bebida'), '2');
    expect(link.getByText('Obrigatório')).toBeInTheDocument();

    await ui.click(within(panel).getByRole('button', { name: 'Criar item' }));
    const problems = errorList(panel);
    expect(problems).toContain('O EAN deve ter até 14 dígitos');
    expect(problems).toContain('O preço “de” deve ser maior que o preço “por”.');
    expect(problems).toContain('Horário 1: início e fim não podem ser iguais.');
    expect(problems).toContain('“Escolha a bebida”: o máximo deve ser maior ou igual ao mínimo.');
    expect(api.called('POST', '/catalog/items')).toHaveLength(0);

    await ui.clear(within(panel).getByLabelText('EAN'));
    await ui.type(within(panel).getByLabelText('EAN'), '789123');
    await ui.clear(within(panel).getByLabelText('Preço “de” (promoção)'));
    await ui.type(within(panel).getByLabelText('Preço “de” (promoção)'), '30,00');
    fireEvent.change(shift.getByLabelText('Fim do horário 1'), { target: { value: '02:00' } });
    expect(shift.getByText('(termina no dia seguinte)')).toBeInTheDocument();
    await ui.clear(link.getByLabelText('Máximo de Escolha a bebida'));
    await ui.type(link.getByLabelText('Máximo de Escolha a bebida'), '2');
    await ui.click(within(panel).getByRole('button', { name: 'Criar item' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/items')[0].body).toEqual({
        category_id: 1,
        type: 'default',
        product: {
          name: 'Hambúrguer duplo',
          description: 'Dois discos',
          external_code: null,
          ean: '789123',
          serving: 'serves_2',
          dietary: ['vegetarian'],
          slices: null,
        },
        price_cents: 2500,
        original_price_cents: 3000,
        status: 'available',
        external_code: 'HD01',
        shifts: [{ days: [1, 2, 3, 4, 5, 6], start: '11:00', end: '02:00' }],
        groups: [{ group_id: 1, min: 2, max: 2, position: 0 }],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits an item: photo upload/remove, link order, quick group and server errors', async () => {
    const cutlery = group(9, 'Talheres', { type: 'cutlery', options: [option(91, 'Garfo', 0)] });
    const api = fakeApi({
      ...catalogRoutes(),
      'POST /catalog/products/10/image': product(10, 'X-Burger', {
        image_url: '/api/v1/catalog/images/novo.png',
      }),
      'DELETE /catalog/products/10/image': { ok: true },
      'POST /catalog/groups': cutlery,
      'PATCH /catalog/items/10': () => {
        throw status(422, 'Código PDV já usado por outro item');
      },
    });
    const ui = await openEditor('X-Burger');
    const panel = screen.getByRole('dialog', { name: 'Editar X-Burger' });
    expect(within(panel).getByLabelText('Nome do item')).toHaveValue('X-Burger');
    expect(within(panel).getByLabelText('Preço')).toHaveValue('29,90');
    expect(within(panel).getByRole('img', { name: 'Foto de X-Burger' })).toHaveAttribute(
      'src',
      '/api/v1/catalog/images/xb.jpg',
    );

    const file = new File(['png'], 'foto.png', { type: 'image/png' });
    await ui.upload(within(panel).getByLabelText('Arquivo da foto'), file);
    await waitFor(() =>
      expect(within(panel).getByRole('img', { name: 'Foto de X-Burger' })).toHaveAttribute(
        'src',
        '/api/v1/catalog/images/novo.png',
      ),
    );
    const sent = api.called('POST', '/catalog/products/10/image')[0].body as FormData;
    expect((sent.get('image') as File).name).toBe('foto.png');
    await ui.upload(
      within(panel).getByLabelText('Arquivo da foto'),
      new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }),
    );
    expect(await within(panel).findByText('Envie uma imagem PNG, JPG ou WebP.')).toBeInTheDocument();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.jpg', { type: 'image/jpeg' });
    await ui.upload(within(panel).getByLabelText('Arquivo da foto'), big);
    expect(await within(panel).findByText('A imagem deve ter no máximo 5 MB.')).toBeInTheDocument();
    await ui.click(within(panel).getByRole('button', { name: 'Remover foto' }));
    await waitFor(() => expect(api.called('DELETE', '/catalog/products/10/image')).toHaveLength(1));
    expect(within(panel).queryByRole('img', { name: 'Foto de X-Burger' })).not.toBeInTheDocument();

    await ui.click(within(panel).getByRole('button', { name: 'Descer Escolha a bebida' }));
    await ui.click(within(panel).getByRole('button', { name: 'Subir Escolha a bebida' }));
    await ui.click(within(panel).getByRole('button', { name: 'Remover Adicionais' }));
    expect(within(panel).queryByRole('listitem', { name: 'Adicionais' })).not.toBeInTheDocument();

    await ui.click(within(panel).getByRole('button', { name: 'Criar grupo' }));
    const create = screen.getByRole('dialog', { name: 'Novo grupo de complementos' });
    await ui.type(within(create).getByLabelText('Nome do grupo'), 'Talheres');
    await ui.selectOptions(within(create).getByLabelText('Tipo'), 'cutlery');
    await ui.type(within(create).getByLabelText('Nome da opção 1'), 'Garfo');
    await ui.click(within(create).getByRole('button', { name: 'Salvar grupo' }));
    expect(await within(panel).findByRole('listitem', { name: 'Talheres' })).toBeInTheDocument();
    expect(api.called('POST', '/catalog/groups')[0].body).toMatchObject({
      name: 'Talheres',
      type: 'cutlery',
    });

    await ui.click(within(panel).getByRole('button', { name: 'Salvar item' }));
    expect(await within(panel).findByText('Código PDV já usado por outro item')).toBeInTheDocument();
    expect(api.called('PATCH', '/catalog/items/10')[0].body).toMatchObject({
      price_cents: 2990,
      original_price_cents: 3490,
      groups: [
        { group_id: 1, min: 1, max: 1, position: 0 },
        { group_id: 9, min: 0, max: 1, position: 1 },
      ],
    });
  });

  it('deletes an item after confirmation', async () => {
    const api = fakeApi({ ...catalogRoutes(), 'DELETE /catalog/items/11': { ok: true } });
    const ui = await openEditor('Batata frita');
    await ui.click(screen.getByRole('button', { name: 'Excluir item' }));
    const confirm = screen.getByRole('dialog', { name: 'Excluir item' });
    expect(confirm).toHaveTextContent('Excluir “Batata frita” do cardápio?');
    await ui.click(within(confirm).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(api.called('DELETE', '/catalog/items/11')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
