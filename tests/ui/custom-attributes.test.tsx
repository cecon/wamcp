import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import { ContactPanel } from '../../src/agent/conversations/ContactPanel';
import type { AttributeDefinition } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, contact, conversation, definition, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

describe('custom attribute settings', () => {
  it('lists by model and creates, edits and deletes definitions', async () => {
    let defs: AttributeDefinition[] = [
      definition(1, { attribute_display_name: 'Plano', attribute_description: 'Plano contratado' }),
      definition(2, {
        attribute_display_name: 'Aniversário',
        attribute_model: 'contact',
        attribute_display_type: 'date',
      }),
    ];
    const api = fakeApi({
      'GET /custom_attribute_definitions': () => defs,
      'POST /custom_attribute_definitions': (body) => {
        if ((body as { attribute_display_name: string }).attribute_display_name === 'Duplicado')
          throw status(422, 'Chave já existe');
        return definition(3);
      },
      'PATCH /custom_attribute_definitions/1': (body) => ({ ...defs[0], ...(body as object) }),
      'DELETE /custom_attribute_definitions/1': () => {
        defs = defs.slice(1);
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    render(
      <SettingsRouter
        route={{ page: 'settings', section: 'attributes' }}
        user={admin}
        catalog={catalog}
        onNavigate={vi.fn()}
        onChange={vi.fn(async () => {})}
      />,
    );
    expect(await screen.findByText('Plano contratado')).toBeInTheDocument();
    expect(screen.getByText('1 atributo')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Contato' }));
    expect(screen.getByText('Aniversário')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Conversa' }));

    await user.click(screen.getByRole('button', { name: 'Adicionar atributo' }));
    let dialog = screen.getByRole('dialog', { name: 'Adicionar atributo' });
    await user.type(within(dialog).getByLabelText('Nome de exibição'), 'Nível');
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'list');
    await user.type(within(dialog).getByLabelText(/Opções da lista/), 'ouro, prata,');
    await user.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.called('POST', '/custom_attribute_definitions')[0].body).toEqual({
      attribute_display_name: 'Nível',
      attribute_description: null,
      attribute_values: ['ouro', 'prata'],
      regex_pattern: null,
      regex_cue: null,
      attribute_model: 'conversation',
      attribute_display_type: 'list',
    });

    await user.click(screen.getByRole('button', { name: 'Adicionar atributo' }));
    dialog = screen.getByRole('dialog', { name: 'Adicionar atributo' });
    await user.selectOptions(within(dialog).getByLabelText('Aplica-se a'), 'contact');
    await user.type(within(dialog).getByLabelText('Nome de exibição'), 'Duplicado');
    await user.type(within(dialog).getByLabelText('Chave'), 'cpf');
    await user.type(within(dialog).getByLabelText('Padrão (regex)'), '^\\d{{11}$');
    await user.type(within(dialog).getByLabelText('Dica do padrão'), '11 dígitos');
    await user.type(within(dialog).getByLabelText('Descrição'), 'Documento');
    await user.click(within(dialog).getByRole('button', { name: 'Criar' }));
    expect(await within(dialog).findByText('Chave já existe')).toBeInTheDocument();
    expect(api.called('POST', '/custom_attribute_definitions')[1].body).toMatchObject({
      attribute_key: 'cpf',
      attribute_model: 'contact',
      regex_pattern: '^\\d{11}$',
      regex_cue: '11 dígitos',
      attribute_description: 'Documento',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Editar Plano' }));
    dialog = screen.getByRole('dialog', { name: 'Editar atributo' });
    expect(within(dialog).getByLabelText('Chave')).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Nome de exibição'));
    await user.type(within(dialog).getByLabelText('Nome de exibição'), 'Plano atual');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/custom_attribute_definitions/1')[0].body).toMatchObject({
        attribute_display_name: 'Plano atual',
        attribute_description: 'Plano contratado',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Excluir Plano' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Nenhum atributo personalizado ainda.')).toBeInTheDocument();
  });
});

describe('attribute inputs', () => {
  const conversationDefs = [
    definition(1, {
      attribute_display_name: 'Pedido',
      regex_pattern: '^\\d+$',
      regex_cue: 'Somente números',
    }),
    definition(2, { attribute_display_name: 'Valor', attribute_display_type: 'currency' }),
    definition(3, {
      attribute_display_name: 'Plano',
      attribute_display_type: 'list',
      attribute_values: ['ouro'],
    }),
    definition(4, { attribute_display_name: 'VIP', attribute_display_type: 'checkbox' }),
    definition(5, { attribute_display_name: 'Entrega', attribute_display_type: 'date' }),
    definition(6, {
      attribute_display_name: 'Site',
      attribute_display_type: 'link',
      attribute_description: 'URL',
    }),
  ];
  it('saves typed conversation and contact attributes and shows validation errors', async () => {
    let attrs: Record<string, unknown> = { attr_1: '12' };
    const api = fakeApi({
      'GET /contacts/50': { ...contact, custom_attributes: {} },
      'GET /conversations/7/participants': [],
      'GET /custom_attribute_definitions': (_b: unknown, url: URL) =>
        url.searchParams.get('attribute_model') === 'contact'
          ? [definition(9, { attribute_display_name: 'Empresa', attribute_model: 'contact' })]
          : conversationDefs,
      'POST /conversations/7/custom_attributes': (body) => {
        const next = (body as { custom_attributes: Record<string, unknown> }).custom_attributes;
        if (next.attr_2 === 0) throw status(422, 'Valor inválido para o atributo');
        attrs = { ...attrs, ...next };
        return { ...conversation, custom_attributes: attrs };
      },
      'PATCH /contacts/50': (body) => ({ ...contact, ...(body as object) }),
    });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactPanel
        conversation={{ ...conversation, custom_attributes: { attr_1: '12' } }}
        user={admin}
        catalog={catalog}
        onChange={onChange}
        onError={vi.fn()}
        onOpenConversation={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Atributos da conversa' }));
    const pedido = await screen.findByLabelText('Pedido');
    expect(pedido).toHaveValue('12');
    expect(screen.getByText('Somente números')).toBeInTheDocument();
    await user.clear(pedido);
    await user.type(pedido, 'abc');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Somente números');
    await user.clear(pedido);
    await user.type(pedido, '42{Enter}');
    await user.type(screen.getByLabelText('Valor'), '0');
    await user.tab();
    expect(await screen.findByText('Valor inválido para o atributo')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Plano'), 'ouro');
    await user.click(screen.getByLabelText('VIP'));
    fireEvent.change(screen.getByLabelText('Entrega'), { target: { value: '2026-12-01' } });
    await user.type(screen.getByLabelText('Site'), 'https://exemplo.com');
    await user.tab();
    await waitFor(() => expect(api.called('POST', '/conversations/7/custom_attributes')).toHaveLength(6));
    expect(api.called('POST', '/conversations/7/custom_attributes').map((c) => c.body)).toEqual([
      { custom_attributes: { attr_1: '42' } },
      { custom_attributes: { attr_2: 0 } },
      { custom_attributes: { attr_3: 'ouro' } },
      { custom_attributes: { attr_4: true } },
      { custom_attributes: { attr_5: '2026-12-01' } },
      { custom_attributes: { attr_6: 'https://exemplo.com' } },
    ]);
    expect(onChange).toHaveBeenCalledTimes(5);

    await user.click(screen.getByRole('button', { name: 'Atributos do contato' }));
    await user.type(await screen.findByLabelText('Empresa'), 'ACME{Enter}');
    await waitFor(() =>
      expect(api.called('PATCH', '/contacts/50')[0].body).toEqual({ custom_attributes: { attr_9: 'ACME' } }),
    );
  });

  it('explains when there are no definitions and clears values with null', async () => {
    const api = fakeApi({
      'GET /contacts/50': contact,
      'GET /custom_attribute_definitions': (_b: unknown, url: URL) =>
        url.searchParams.get('attribute_model') === 'contact' ? [] : [definition(1)],
      'POST /conversations/7/custom_attributes': { ...conversation, custom_attributes: {} },
    });
    const user = userEvent.setup();
    render(
      <ContactPanel
        conversation={{ ...conversation, custom_attributes: { attr_1: 'x' } }}
        user={admin}
        catalog={catalog}
        onChange={vi.fn()}
        onError={vi.fn()}
        onOpenConversation={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Atributos do contato' }));
    expect(await screen.findByText(/Nenhum atributo personalizado/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Atributos da conversa' }));
    const input = await screen.findByLabelText('Atributo 1');
    await user.click(input);
    await user.tab();
    await user.clear(input);
    await user.tab();
    await waitFor(() =>
      expect(api.called('POST', '/conversations/7/custom_attributes')[0].body).toEqual({
        custom_attributes: { attr_1: null },
      }),
    );
  });
});
