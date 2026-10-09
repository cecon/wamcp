import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import { fakeApi, status } from './fake-api';
import { admin, definition, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const rule = {
  id: 1,
  name: 'Boletos',
  event_name: 'conversation_updated',
  conditions: [],
  actions: [{ action_name: 'mute_conversation', action_params: [] }],
  active: 1,
};
const definitions = [
  definition(1, {
    attribute_key: 'plano',
    attribute_display_name: 'Plano',
    attribute_display_type: 'list',
    attribute_values: ['ouro', 'prata'],
  }),
  definition(2, { attribute_key: 'vip', attribute_display_name: 'VIP', attribute_display_type: 'checkbox' }),
  definition(3, { attribute_key: 'cpf', attribute_display_name: 'CPF' }),
];

function renderAutomation() {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'automation' }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
}

/** Opens the rule side panel once the conversation attribute definitions are loaded. */
async function openEditor() {
  let rules: unknown[] = [];
  const api = fakeApi({
    'GET /automation_rules': () => rules,
    'GET /custom_attribute_definitions': definitions,
    'POST /automation_rules': (body) => {
      rules = [{ ...(body as object), id: 1, active: 1 }];
      return rules[0] as object;
    },
  });
  const user = renderAutomation();
  expect(await screen.findByText('Nenhuma automação ainda.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Criar automação' }));
  const panel = screen.getByRole('dialog', { name: 'Criar automação' });
  expect(await within(panel).findByRole('option', { name: 'Plano' })).toBeInTheDocument();
  expect(api.called('GET', '/custom_attribute_definitions')[0].search).toBe('?attribute_model=conversation');
  await user.type(within(panel).getByLabelText('Nome da regra'), 'R');
  const submit = async () => {
    await user.click(within(panel).getByRole('button', { name: 'Criar automação' }));
    expect(await screen.findByText('R')).toBeInTheDocument();
    return api.called('POST', '/automation_rules')[0].body as Record<string, unknown>;
  };
  return { user, panel, submit };
}

const condition = (attribute_key: string, filter_operator: string, value: string) => ({
  attribute_key,
  filter_operator,
  values: [value],
  query_operator: 'and',
});

describe('automation parity', () => {
  it('builds conditions with the new event, attributes, custom attributes and starts_with', async () => {
    const { user, panel, submit } = await openEditor();
    await user.selectOptions(within(panel).getByLabelText('Evento'), 'conversation_updated');
    await user.selectOptions(within(panel).getByLabelText('Atributo 1'), 'priority');
    await user.selectOptions(within(panel).getByLabelText('Operador 1'), 'equal_to');
    await user.selectOptions(within(panel).getByLabelText('Valor 1'), 'Alta');
    const add = async (n: number, attribute: string, operator: string) => {
      await user.click(within(panel).getByRole('button', { name: 'Adicionar condição' }));
      await user.selectOptions(within(panel).getByLabelText(`Atributo ${n}`), attribute);
      await user.selectOptions(within(panel).getByLabelText(`Operador ${n}`), operator);
    };
    await add(2, 'contact_email', 'starts_with');
    await user.type(within(panel).getByLabelText('Valor 2'), 'a@');
    await add(3, 'custom_attribute:plano', 'equal_to');
    const plans = within(within(panel).getByLabelText('Valor 3')).getAllByRole('option');
    expect(plans.map((o) => o.textContent)).toEqual(['Selecione…', 'ouro', 'prata']);
    await user.selectOptions(within(panel).getByLabelText('Valor 3'), 'prata');
    await add(4, 'custom_attribute:vip', 'equal_to');
    await user.selectOptions(within(panel).getByLabelText('Valor 4'), 'Sim');
    await add(5, 'custom_attribute:cpf', 'contains');
    await user.type(within(panel).getByLabelText('Valor 5'), '1');
    const body = await submit();
    expect(screen.getByText('Conversa atualizada')).toBeInTheDocument();
    expect(body.event_name).toBe('conversation_updated');
    expect(body.conditions).toEqual([
      condition('priority', 'equal_to', 'high'),
      condition('contact_email', 'starts_with', 'a@'),
      condition('custom_attribute:plano', 'equal_to', 'prata'),
      condition('custom_attribute:vip', 'equal_to', 'true'),
      condition('custom_attribute:cpf', 'contains', '1'),
    ]);
  });

  it('offers the new actions, without a parameter where none is needed', async () => {
    const { user, panel, submit } = await openEditor();
    await user.selectOptions(within(panel).getByLabelText('Ação 1'), 'remove_assigned_agent');
    expect(within(panel).queryByLabelText('Parâmetro 1')).not.toBeInTheDocument();
    for (const [i, action] of ['remove_assigned_team', 'mute_conversation', 'change_priority'].entries()) {
      await user.click(within(panel).getByRole('button', { name: 'Adicionar ação' }));
      await user.selectOptions(within(panel).getByLabelText(`Ação ${i + 2}`), action);
    }
    expect(within(panel).queryByLabelText('Parâmetro 3')).not.toBeInTheDocument();
    await user.selectOptions(within(panel).getByLabelText('Parâmetro 4'), 'Baixa');
    const body = await submit();
    expect(body.actions).toEqual([
      { action_name: 'remove_assigned_agent', action_params: [] },
      { action_name: 'remove_assigned_team', action_params: [] },
      { action_name: 'mute_conversation', action_params: [] },
      { action_name: 'change_priority', action_params: ['low'] },
    ]);
  });

  it('clones a rule and reports clone failures', async () => {
    let rules = [rule];
    let clones = 0;
    const api = fakeApi({
      'GET /automation_rules': () => rules,
      'POST /automation_rules/1/clone': () => {
        if (++clones === 2) throw status(404, 'Regra não encontrada');
        rules = [...rules, { ...rule, id: 2, name: 'Boletos (cópia)', active: 0 }];
        return rules[1];
      },
    });
    const user = renderAutomation();
    expect(await screen.findByText('Silenciar conversa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clonar Boletos' }));
    expect(await screen.findByText('Boletos (cópia)')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Ativa Boletos (cópia)' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Clonar Boletos' }));
    expect(await screen.findByText('Regra não encontrada')).toBeInTheDocument();
    expect(api.called('POST', '/automation_rules/1/clone')).toHaveLength(2);
  });
});
