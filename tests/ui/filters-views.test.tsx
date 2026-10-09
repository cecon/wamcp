import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { ContactsPage } from '../../src/agent/ContactsPage';
import type { CustomFilter, FilterCondition } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import {
  admin,
  contact,
  conversation,
  definition,
  inbox,
  labels,
  maria,
  team,
  workspaceRoutes,
} from './fixtures';

const nav = () => screen.getByRole('navigation');
const vipFilter: FilterCondition[] = [
  { attribute_key: 'labels', filter_operator: 'equal_to', values: ['vip'], query_operator: 'and' },
];
const definitions = [
  definition(1, {
    attribute_display_name: 'Plano',
    attribute_display_type: 'list',
    attribute_values: ['ouro'],
  }),
  definition(2, { attribute_display_name: 'Pedidos', attribute_display_type: 'number' }),
  definition(3, { attribute_display_name: 'Assinante', attribute_display_type: 'checkbox' }),
  definition(4, { attribute_display_name: 'Renovação', attribute_display_type: 'date' }),
];

describe('saved conversation views', () => {
  it('opens a folder from the sidebar, renames and deletes it', async () => {
    let views: CustomFilter[] = [
      { id: 3, name: 'VIPs', filter_type: 'conversation', query: { payload: vipFilter } },
    ];
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /custom_filters': () => views,
      'POST /conversations/filter': [conversation],
      'PATCH /custom_filters/3': (body) => (views = [{ ...views[0], ...(body as object) }])[0],
      'DELETE /custom_filters/3': () => {
        views = [];
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await user.click(within(nav()).getByRole('button', { name: 'Não atendidas' }));
    expect(await screen.findByRole('heading', { name: 'Não atendidas' })).toBeInTheDocument();
    await user.click(await within(nav()).findByRole('button', { name: 'VIPs' }));
    expect(await screen.findByRole('heading', { name: 'VIPs' })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.called('POST', '/conversations/filter')[0].body).toEqual({ payload: vipFilter }),
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar visualização' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Opções da visualização' }));
    await user.click(screen.getByRole('menuitem', { name: 'Renomear visualização' }));
    const rename = screen.getByRole('dialog', { name: 'Renomear visualização' });
    await user.clear(within(rename).getByLabelText('Nome da visualização'));
    await user.type(within(rename).getByLabelText('Nome da visualização'), 'Clientes VIP');
    await user.click(within(rename).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('heading', { name: 'Clientes VIP' })).toBeInTheDocument();
    expect(api.called('PATCH', '/custom_filters/3')[0].body).toEqual({ name: 'Clientes VIP' });

    await user.click(screen.getByRole('button', { name: 'Opções da visualização' }));
    await user.click(screen.getByRole('menuitem', { name: 'Excluir visualização' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: 'Clientes VIP' })).not.toBeInTheDocument();
  });

  it('builds an advanced filter with E/OU rows, saves it as a view and clears it', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /custom_attribute_definitions': definitions,
      'POST /conversations/filter': () => [conversation],
      'POST /custom_filters': (body) => ({ id: 9, ...(body as object) }),
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await user.click(screen.getByRole('button', { name: 'Filtrar conversas' }));
    const dialog = screen.getByRole('dialog', { name: 'Filtrar conversas' });
    const field = (name: string) => within(dialog).getByLabelText(name);
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar filtros' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Preencha o valor de todas as condições.');
    await user.selectOptions(field('Valor da condição 1'), 'resolved');
    const add = () => user.click(within(dialog).getByRole('button', { name: 'Adicionar filtro' }));
    await add();
    await user.selectOptions(field('Atributo da condição 2'), 'custom_attribute:attr_2');
    await user.selectOptions(field('Operador da condição 2'), 'is_greater_than');
    await user.type(field('Valor da condição 2'), '10');
    await user.selectOptions(field('Operador entre as condições 1 e 2'), 'or');
    await add();
    await user.selectOptions(field('Atributo da condição 3'), 'created_at');
    await user.selectOptions(field('Operador da condição 3'), 'days_before');
    await user.type(field('Valor da condição 3'), '7');
    await add();
    await user.selectOptions(field('Atributo da condição 4'), 'custom_attribute:attr_3');
    await user.selectOptions(field('Valor da condição 4'), 'true');
    await add();
    await user.selectOptions(field('Atributo da condição 5'), 'assignee_id');
    await user.selectOptions(field('Valor da condição 5'), '2');
    await add();
    await user.selectOptions(field('Atributo da condição 6'), 'custom_attribute:attr_1');
    await user.selectOptions(field('Valor da condição 6'), 'ouro');
    await user.click(within(dialog).getByRole('button', { name: 'Remover condição 6' }));
    await add();
    await user.selectOptions(field('Atributo da condição 6'), 'contact_name');
    await user.selectOptions(field('Operador da condição 6'), 'is_present');
    expect(within(dialog).queryByLabelText('Valor da condição 6')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByRole('heading', { name: 'Resultados do filtro' })).toBeInTheDocument();
    const payload = (api.called('POST', '/conversations/filter')[0].body as { payload: unknown[] }).payload;
    const row = (
      attribute_key: string,
      filter_operator: string,
      values: unknown[],
      query_operator = 'and',
    ) => ({
      attribute_key,
      filter_operator,
      values,
      query_operator,
    });
    expect(payload).toEqual([
      row('status', 'equal_to', ['resolved'], 'or'),
      row('custom_attribute:attr_2', 'is_greater_than', [10]),
      row('created_at', 'days_before', [7]),
      row('custom_attribute:attr_3', 'equal_to', [true]),
      row('assignee_id', 'equal_to', [2]),
      row('contact_name', 'is_present', []),
    ]);

    await user.click(screen.getByRole('button', { name: 'Filtrar conversas' }));
    expect(screen.getByRole('dialog', { name: 'Filtrar conversas' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar visualização' }));
    const save = screen.getByRole('dialog', { name: 'Salvar visualização' });
    await user.type(within(save).getByLabelText('Nome da visualização'), 'Minha pasta');
    await user.click(within(save).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('POST', '/custom_filters')[0].body).toEqual({
        name: 'Minha pasta',
        filter_type: 'conversation',
        query: { payload },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
  });
});

describe('contact filters', () => {
  const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
  it('filters contacts, saves and switches segments, and reports filter errors', async () => {
    let views: CustomFilter[] = [
      { id: 4, name: 'Leads', filter_type: 'contact', query: { payload: vipFilter } },
    ];
    const api = fakeApi({
      'GET /contacts': [contact, { ...contact, id: 51, name: 'Outro' }],
      'POST /contacts/filter': [contact],
      'GET /custom_filters': () => views,
      'GET /custom_attribute_definitions': [
        definition(4, { attribute_model: 'contact', attribute_display_type: 'date' }),
      ],
      'POST /custom_filters': (body) => {
        views = [...views, { id: 5, ...(body as Omit<CustomFilter, 'id'>) }];
        return views[1];
      },
      'DELETE /custom_filters/4': () => {
        views = views.slice(1);
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    render(<ContactsPage onOpenConversation={vi.fn()} user={admin} catalog={catalog} />);
    expect(await screen.findByText('2 contatos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    const dialog = screen.getByRole('dialog', { name: 'Filtrar contatos' });
    await user.selectOptions(
      within(dialog).getByLabelText('Atributo da condição 1'),
      'custom_attribute:attr_4',
    );
    await user.selectOptions(within(dialog).getByLabelText('Operador da condição 1'), 'is_less_than');
    await user.type(within(dialog).getByLabelText('Valor da condição 1'), '2026-01-31');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByText('1 contato')).toBeInTheDocument();
    expect(api.called('POST', '/contacts/filter')[0].body).toEqual({
      payload: [
        {
          attribute_key: 'custom_attribute:attr_4',
          filter_operator: 'is_less_than',
          values: ['2026-01-31'],
          query_operator: 'and',
        },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Salvar visualização' }));
    await user.type(screen.getByLabelText('Nome da visualização'), 'Renovações');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByLabelText('Visualizações de contatos')).toHaveValue('5'));
    expect((api.called('POST', '/custom_filters')[0].body as { filter_type: string }).filter_type).toBe(
      'contact',
    );

    await user.selectOptions(screen.getByLabelText('Visualizações de contatos'), '4');
    await waitFor(() =>
      expect(api.called('POST', '/contacts/filter').at(-1)!.body).toEqual({ payload: vipFilter }),
    );
    await user.click(screen.getByRole('button', { name: 'Opções da visualização' }));
    await user.click(screen.getByRole('menuitem', { name: 'Excluir visualização' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('2 contatos')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Visualizações de contatos'), '5');
    await user.selectOptions(screen.getByLabelText('Visualizações de contatos'), '');
    api.route('POST /contacts/filter', () => {
      throw status(422, 'Atributo de filtro inválido');
    });
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preencha o valor');
    await user.selectOptions(screen.getByLabelText('Operador da condição 1'), 'is_present');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByText('Atributo de filtro inválido')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('2 contatos')).toBeInTheDocument();
  });
});
