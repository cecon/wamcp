import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogScreen } from '../../src/agent/catalog/CatalogScreen';
import type { Quote } from '../../src/agent/catalog/types';
import { fakeApi, status } from './fake-api';
import { maria } from './fixtures';
import { catalogRoutes } from './catalog-fixtures';

async function openSimulator(name: string, category?: string) {
  const ui = userEvent.setup();
  render(<CatalogScreen user={maria} section="menu" onNavigate={vi.fn()} />);
  if (category)
    await ui.click(
      await screen.findByRole('button', { name: new RegExp(`^${category}`) }, { timeout: 5000 }),
    );
  await ui.click(await screen.findByRole('button', { name }, { timeout: 5000 }));
  const panel = screen.getByRole('dialog', { name });
  await ui.click(within(panel).getByRole('tab', { name: 'Simulador' }));
  return { ui, p: within(panel) };
}

const quote: Quote = {
  unit_price_cents: 4390,
  total_price_cents: 8780,
  lines: [
    { name: 'X-Burger', external_code: 'XB01', quantity: 1, unit_price_cents: 2990 },
    { name: 'Coca-Cola', external_code: 'COCA', quantity: 1, unit_price_cents: 600 },
    { name: 'Bacon', external_code: null, quantity: 2, unit_price_cents: 400 },
  ],
  errors: [],
};

describe('order simulator', () => {
  it('quotes the chosen options and shows lines, total and rule errors', async () => {
    let answer: unknown = quote;
    const api = fakeApi({
      ...catalogRoutes(),
      'POST /catalog/quote': () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    const { ui, p } = await openSimulator('X-Burger');
    expect(p.getByRole('tab', { name: 'Simulador' })).toHaveAttribute('aria-selected', 'true');
    const drinks = within(p.getByRole('group', { name: /Escolha a bebida/ }));
    expect(drinks.getByText('(escolha 1)')).toBeInTheDocument();
    expect(drinks.getByText('Obrigatório')).toBeInTheDocument();
    expect(p.getByText('(até 3)')).toBeInTheDocument();

    await ui.click(p.getByRole('checkbox', { name: /Coca-Cola/ }));
    await ui.clear(p.getByLabelText('Quantidade de Bacon'));
    await ui.type(p.getByLabelText('Quantidade de Bacon'), '2');
    await ui.clear(p.getByLabelText('Quantidade'));
    await ui.type(p.getByLabelText('Quantidade'), '2');
    await ui.type(p.getByLabelText(/Observações/), 'sem cebola');
    expect(p.getByText('Observações (10/140)')).toBeInTheDocument();
    await ui.click(p.getByRole('button', { name: 'Calcular' }));
    const result = within(await p.findByLabelText('Resultado do cálculo'));
    expect(api.called('POST', '/catalog/quote')[0].body).toEqual({
      item_id: 10,
      quantity: 2,
      notes: 'sem cebola',
      choices: [
        { option_id: 11, quantity: 1, choices: [] },
        { option_id: 21, quantity: 2, choices: [] },
      ],
    });
    expect(result.getByText('Total R$ 87,80')).toBeInTheDocument();
    expect(result.getByText('Unitário R$ 43,90')).toBeInTheDocument();
    expect(result.getByText('PDV XB01')).toBeInTheDocument();
    expect(result.getByText('R$ 8,00')).toBeInTheDocument();

    answer = { ...quote, errors: ['Escolha 1 opção em ‘Escolha a bebida’'] };
    await ui.click(p.getByRole('checkbox', { name: /Coca-Cola/ }));
    await ui.click(p.getByRole('button', { name: 'Calcular' }));
    expect(await result.findByRole('alert')).toHaveTextContent('Escolha 1 opção em ‘Escolha a bebida’');
    expect(api.called('POST', '/catalog/quote')[1].body).toMatchObject({
      choices: [{ option_id: 21, quantity: 2, choices: [] }],
    });

    answer = status(422, 'Item indisponível agora');
    await ui.click(p.getByRole('button', { name: 'Calcular' }));
    await waitFor(() =>
      expect(p.getAllByRole('alert').map((a) => a.textContent)).toContain('Item indisponível agora'),
    );
  });

  it('prices pizza flavors by the chosen size', async () => {
    const api = fakeApi({ ...catalogRoutes(), 'POST /catalog/quote': { ...quote, lines: [], errors: [] } });
    const { ui, p } = await openSimulator('Calabresa', 'Pizzas');
    const flavors = within(p.getByRole('group', { name: /Sabores/ }));
    expect(flavors.getByText('—')).toBeInTheDocument();
    expect(p.getByText('(escolha de 1 a 2)')).toBeInTheDocument();
    await ui.click(p.getByRole('checkbox', { name: /Grande/ }));
    expect(flavors.getByText('+ R$ 5,00')).toBeInTheDocument();
    await ui.click(flavors.getByRole('checkbox', { name: /Calabresa/ }));
    await ui.click(p.getByRole('button', { name: 'Calcular' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/quote')[0].body).toEqual({
        item_id: 20,
        quantity: 1,
        choices: [
          { option_id: 52, quantity: 1, choices: [] },
          { option_id: 81, quantity: 1, choices: [] },
        ],
      }),
    );
  });
});
