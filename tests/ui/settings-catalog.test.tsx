import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
function renderSettings(section: SettingsSection) {
  const onChange = vi.fn(async () => {});
  render(
    <SettingsRouter
      route={{ page: 'settings', section }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('labels', () => {
  it('creates, edits, searches and deletes labels', async () => {
    const api = fakeApi({ 'POST /labels': {}, 'PATCH /labels/1': {}, 'DELETE /labels/2': { ok: true } });
    const { user, onChange } = renderSettings('labels');
    expect(screen.getByText('Clientes VIP')).toBeInTheDocument();
    expect(screen.getByText('#ff0000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar etiqueta' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar etiqueta' });
    await user.type(within(dialog).getByLabelText('Nome da etiqueta'), 'Urgente');
    await user.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(api.called('POST', '/labels')[0].body).toEqual({
        title: 'Urgente',
        description: null,
        color: '#2781F6',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Editar vip' }));
    const edit = screen.getByRole('dialog', { name: 'Editar etiqueta' });
    await user.clear(within(edit).getByLabelText('Descrição'));
    await user.type(within(edit).getByLabelText('Descrição'), 'Top');
    await user.click(within(edit).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/labels/1')[0].body).toEqual({
        title: 'vip',
        description: 'Top',
        color: '#ff0000',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Excluir financeiro' }));
    await waitFor(() => expect(api.called('DELETE', '/labels/2')).toHaveLength(1));
    await user.type(screen.getByLabelText('Pesquisar etiquetas…'), 'zzz');
    expect(screen.getByText('Nenhuma etiqueta ainda.')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });
});

describe('canned responses', () => {
  it('creates, edits and deletes canned responses', async () => {
    let items = [{ id: 1, short_code: 'oi', content: 'Olá!' }];
    const api = fakeApi({
      'GET /canned_responses': () => items,
      'POST /canned_responses': (body) => {
        items = [...items, { id: 2, ...(body as { short_code: string; content: string }) }];
        return items[1];
      },
      'PATCH /canned_responses/1': (body) => {
        items = items.map((c) => (c.id === 1 ? { ...c, ...(body as object) } : c));
        return items[0];
      },
      'DELETE /canned_responses/1': () => {
        items = items.filter((c) => c.id !== 1);
        return { ok: true };
      },
    });
    const { user } = renderSettings('canned');
    expect(await screen.findByText('/oi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar resposta pronta' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar resposta pronta' });
    await user.type(within(dialog).getByLabelText('Atalho'), 'prazo');
    await user.type(within(dialog).getByLabelText('Mensagem'), '3 dias úteis');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('/prazo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar /oi' }));
    const edit = screen.getByRole('dialog', { name: 'Editar resposta pronta' });
    await user.clear(within(edit).getByLabelText('Mensagem'));
    await user.type(within(edit).getByLabelText('Mensagem'), 'Oi!');
    await user.click(within(edit).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Oi!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Excluir /oi' }));
    await waitFor(() => expect(screen.queryByText('/oi')).not.toBeInTheDocument());
    expect(api.called('POST', '/canned_responses')[0].body).toEqual({
      short_code: 'prazo',
      content: '3 dias úteis',
    });
  });
});

describe('automation', () => {
  it('builds a rule in the side panel, toggles and deletes it', async () => {
    let rules: unknown[] = [];
    const api = fakeApi({
      'GET /automation_rules': () => rules,
      'POST /automation_rules': (body) => {
        if ((body as { name: string }).name === 'falha') throw status(400, 'Informe o parâmetro da ação');
        rules = [{ ...(body as object), id: 1, active: 1 }];
        return rules[0] as object;
      },
      'PATCH /automation_rules/1': {},
      'DELETE /automation_rules/1': () => {
        rules = [];
        return { ok: true };
      },
    });
    const { user } = renderSettings('automation');
    expect(await screen.findByText('Nenhuma automação ainda.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar automação' }));
    const panel = screen.getByRole('dialog', { name: 'Criar automação' });
    await user.type(within(panel).getByLabelText('Nome da regra'), 'falha');
    await user.click(within(panel).getByRole('button', { name: 'Criar automação' }));
    expect(await within(panel).findByText('Informe o parâmetro da ação')).toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('Nome da regra'));
    await user.type(within(panel).getByLabelText('Nome da regra'), 'Boletos');
    await user.selectOptions(within(panel).getByLabelText('Evento'), 'conversation_created');
    await user.type(within(panel).getByLabelText('Valor 1'), 'boleto');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar condição' }));
    await user.selectOptions(within(panel).getByLabelText('Junção 1'), 'or');
    await user.selectOptions(within(panel).getByLabelText('Atributo 2'), 'inbox_id');
    await user.selectOptions(within(panel).getByLabelText('Operador 2'), 'equal_to');
    await user.selectOptions(within(panel).getByLabelText('Valor 2'), '10');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar condição' }));
    await user.selectOptions(within(panel).getByLabelText('Operador 3'), 'is_present');
    await user.click(within(panel).getByRole('button', { name: 'Remover condição 3' }));
    for (const [attribute, option] of [
      ['status', 'Resolvida'],
      ['message_type', 'Recebida'],
      ['assignee_id', 'Admin'],
      ['team_id', 'Financeiro'],
      ['labels', 'vip'],
    ]) {
      await user.click(within(panel).getByRole('button', { name: 'Adicionar condição' }));
      await user.selectOptions(within(panel).getByLabelText('Atributo 3'), attribute);
      expect(
        within(within(panel).getByLabelText('Valor 3')).getByRole('option', { name: option }),
      ).toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'Remover condição 3' }));
    }
    await user.selectOptions(within(panel).getByLabelText('Parâmetro 1'), 'vip');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar ação' }));
    await user.selectOptions(within(panel).getByLabelText('Ação 2'), 'send_message');
    await user.type(within(panel).getByLabelText('Parâmetro 2'), 'Já encaminhei.');
    for (const [action, option] of [
      ['assign_agent', 'Maria Souza'],
      ['assign_team', 'Financeiro'],
      ['set_priority', 'Urgente'],
    ]) {
      await user.click(within(panel).getByRole('button', { name: 'Adicionar ação' }));
      await user.selectOptions(within(panel).getByLabelText('Ação 3'), action);
      expect(
        within(within(panel).getByLabelText('Parâmetro 3')).getByRole('option', { name: option }),
      ).toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'Remover ação 3' }));
    }
    await user.click(within(panel).getByRole('button', { name: 'Adicionar ação' }));
    await user.selectOptions(within(panel).getByLabelText('Ação 3'), 'resolve_conversation');
    expect(within(panel).queryByLabelText('Parâmetro 3')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Criar automação' }));
    expect(await screen.findByText('Boletos')).toBeInTheDocument();
    expect(api.called('POST', '/automation_rules')[1].body).toEqual({
      name: 'Boletos',
      event_name: 'conversation_created',
      conditions: [
        { attribute_key: 'content', filter_operator: 'contains', values: ['boleto'], query_operator: 'or' },
        { attribute_key: 'inbox_id', filter_operator: 'equal_to', values: ['10'], query_operator: 'and' },
      ],
      actions: [
        { action_name: 'add_label', action_params: ['vip'] },
        { action_name: 'send_message', action_params: ['Já encaminhei.'] },
        { action_name: 'resolve_conversation', action_params: [] },
      ],
    });
    await user.click(screen.getByRole('switch', { name: 'Ativa Boletos' }));
    await waitFor(() => expect(api.called('PATCH', '/automation_rules/1')).toHaveLength(1));
    await user.type(screen.getByLabelText('Pesquisar automações…'), 'bol');
    await user.click(screen.getByRole('button', { name: 'Excluir Boletos' }));
    expect(await screen.findByText('Nenhuma automação ainda.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar automação' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }, 30_000); // ~4 s alone; many typed fields make it slow when the machine is busy
});

describe('webhooks', () => {
  it('creates (showing the secret), edits, toggles, inspects and deletes webhooks', async () => {
    let hooks = [
      {
        id: 1,
        url: 'https://crm.example/a',
        subscriptions: ['message_created'],
        inbox_id: 10,
        secret: 'abc',
        active: 1,
      },
    ];
    const api = fakeApi({
      'GET /webhooks': () => hooks,
      'POST /webhooks': (body) => {
        hooks = [...hooks, { ...(body as (typeof hooks)[0]), id: 2, secret: 'segredo-novo', active: 1 }];
        return hooks[1];
      },
      'PATCH /webhooks/1': {},
      'DELETE /webhooks/1': () => {
        hooks = hooks.slice(1);
        return { ok: true };
      },
      'GET /webhooks/1/deliveries': [
        {
          id: 1,
          event: 'message_created',
          status: 'failed',
          attempts: 5,
          response_status: 500,
          last_error: 'HTTP 500',
          created_at: 1,
        },
        {
          id: 2,
          event: 'other',
          status: 'sent',
          attempts: 1,
          response_status: 200,
          last_error: null,
          created_at: 2,
        },
      ],
    });
    const { user } = renderSettings('webhooks');
    expect(await screen.findByText('https://crm.example/a')).toBeInTheDocument();
    expect(screen.getByText(/Eventos assinados: Mensagem criada · Suporte/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entregas' }));
    const panel = screen.getByRole('dialog', { name: 'Entregas recentes' });
    expect(within(panel).getByText(/falhou \(5x\) · HTTP 500/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Fechar' }));

    await user.click(screen.getByRole('switch', { name: 'Ativo https://crm.example/a' }));
    await waitFor(() => expect(api.called('PATCH', '/webhooks/1')[0].body).toEqual({ active: false }));
    await user.click(screen.getByRole('button', { name: 'Editar https://crm.example/a' }));
    const edit = screen.getByRole('dialog', { name: 'Editar webhook' });
    expect(within(edit).getByLabelText('Segredo de assinatura')).toHaveValue('abc');
    await user.click(within(edit).getByRole('button', { name: 'Copiar segredo' }));
    expect(await navigator.clipboard.readText()).toBe('abc');
    await user.click(within(edit).getByRole('button', { name: 'Atualizar webhook' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/webhooks/1')[1].body).toEqual({
        url: 'https://crm.example/a',
        subscriptions: ['message_created'],
        inbox_id: 10,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar novo webhook' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar novo webhook' });
    await user.type(within(dialog).getByLabelText('URL do webhook'), 'https://erp.example/hook');
    await user.click(within(dialog).getByLabelText(/Avaliação recebida/));
    await user.click(within(dialog).getByLabelText(/Mensagem criada/));
    await user.click(within(dialog).getByLabelText(/Conversa criada/));
    await user.click(within(dialog).getByRole('button', { name: 'Criar webhook' }));
    expect(await within(dialog).findByLabelText('Segredo de assinatura')).toHaveValue('segredo-novo');
    expect(api.called('POST', '/webhooks')[0].body).toEqual({
      url: 'https://erp.example/hook',
      subscriptions: ['csat_created'],
      inbox_id: null,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByText('https://erp.example/hook')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Excluir https://crm.example/a' }));
    await waitFor(() => expect(screen.queryByText('https://crm.example/a')).not.toBeInTheDocument());
    await user.type(screen.getByLabelText('Pesquisar webhooks…'), 'nada');
    expect(screen.getByText('Nenhum webhook cadastrado.')).toBeInTheDocument();
  });
});
