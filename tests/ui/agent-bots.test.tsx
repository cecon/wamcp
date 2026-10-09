import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { AgentBot } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const bot = (id: number, fields: Partial<AgentBot> = {}): AgentBot => ({
  id,
  name: `Robô ${id}`,
  description: null,
  outgoing_url: `https://bot${id}.example/hook`,
  inbox_ids: [],
  ...fields,
});

function renderSettings(section: SettingsSection, id?: number, current = catalog) {
  const onChange = vi.fn(async () => {});
  render(
    <SettingsRouter
      route={{ page: 'settings', section, id }}
      user={admin}
      catalog={current}
      onNavigate={vi.fn()}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('agent bots settings', () => {
  it('lists bots and creates one showing its token once', async () => {
    let bots = [bot(1, { description: 'Triagem', inbox_ids: [10] }), bot(2, { inbox_ids: [99] })];
    const api = fakeApi({
      'GET /agent_bots': () => bots,
      'POST /agent_bots': (body) => {
        if ((body as { name: string }).name === 'Falha') throw status(422, 'URL inválida');
        bots = [...bots, bot(3, body as Partial<AgentBot>)];
        return { agent_bot: bots[2], access_token: 'tok-123' };
      },
    });
    const { user } = renderSettings('agent_bots');
    expect(await screen.findByText('Robô 1')).toBeInTheDocument();
    expect(screen.getByText('Triagem')).toBeInTheDocument();
    expect(screen.getByText('Suporte')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('2 robôs')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar robô' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar robô' });
    await user.type(within(dialog).getByLabelText('Nome do robô'), 'Falha');
    await user.type(within(dialog).getByLabelText('URL de saída'), 'https://novo.example/bot');
    await user.click(within(dialog).getByRole('button', { name: 'Criar robô' }));
    expect(await within(dialog).findByText('URL inválida')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Nome do robô'));
    await user.type(within(dialog).getByLabelText('Nome do robô'), 'Novo');
    await user.type(within(dialog).getByLabelText('Descrição'), ' Atende à noite ');
    await user.click(within(dialog).getByRole('button', { name: 'Criar robô' }));
    expect(await within(dialog).findByLabelText('Token de acesso')).toHaveValue('tok-123');
    expect(within(dialog).getByText(/não será exibido novamente/)).toBeInTheDocument();
    expect(api.called('POST', '/agent_bots')[1].body).toEqual({
      name: 'Novo',
      description: 'Atende à noite',
      outgoing_url: 'https://novo.example/bot',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Copiar token' }));
    expect(await navigator.clipboard.readText()).toBe('tok-123');
    await user.click(within(dialog).getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByText('Novo')).toBeInTheDocument();
    expect(screen.getByText('3 robôs')).toBeInTheDocument();
  });

  it('edits, resets the token, shows deliveries and deletes a bot', async () => {
    let bots = [bot(1, { description: 'Triagem' })];
    const api = fakeApi({
      'GET /agent_bots': () => bots,
      'PATCH /agent_bots/1': (body) => (bots = [{ ...bots[0], ...(body as object) }])[0],
      'POST /agent_bots/1/reset_access_token': { access_token: 'tok-novo' },
      'GET /agent_bots/1/deliveries': [
        {
          id: 1,
          event: 'message_created',
          status: 'sent',
          attempts: 1,
          response_status: 200,
          last_error: null,
          created_at: 1,
        },
      ],
      'DELETE /agent_bots/1': () => {
        bots = [];
        return { ok: true };
      },
    });
    const { user, onChange } = renderSettings('agent_bots');
    await user.click(await screen.findByRole('button', { name: 'Editar Robô 1' }));
    const edit = screen.getByRole('dialog', { name: 'Editar robô' });
    expect(within(edit).getByLabelText('URL de saída')).toHaveValue('https://bot1.example/hook');
    await user.clear(within(edit).getByLabelText('Descrição'));
    await user.click(within(edit).getByRole('button', { name: 'Atualizar robô' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.called('PATCH', '/agent_bots/1')[0].body).toEqual({
      name: 'Robô 1',
      description: null,
      outgoing_url: 'https://bot1.example/hook',
    });
    await waitFor(() => expect(screen.queryByText('Triagem')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Gerar novo token Robô 1' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gerar novo token Robô 1' }));
    await user.click(screen.getByRole('button', { name: 'Gerar novo token' }));
    const tokenDialog = await screen.findByRole('dialog', { name: 'Novo token de Robô 1' });
    expect(within(tokenDialog).getByLabelText('Token de acesso')).toHaveValue('tok-novo');
    await user.click(within(tokenDialog).getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entregas Robô 1' }));
    const panel = await screen.findByRole('dialog', { name: 'Entregas recentes' });
    expect(within(panel).getByText('Mensagem criada')).toBeInTheDocument();
    expect(within(panel).getByText(/entregue \(1x\)/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Fechar' }));

    await user.click(screen.getByRole('button', { name: 'Excluir Robô 1' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Nenhum robô ainda.')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it('reports a failed deliveries request', async () => {
    fakeApi({
      'GET /agent_bots': [bot(1)],
      'GET /agent_bots/1/deliveries': () => {
        throw status(500, 'Falha ao carregar');
      },
    });
    const { user } = renderSettings('agent_bots');
    await user.click(await screen.findByRole('button', { name: 'Entregas Robô 1' }));
    expect(await screen.findByText('Falha ao carregar')).toBeInTheDocument();
  });
});

describe('inbox agent bot', () => {
  it('connects and disconnects a bot from the inbox settings', async () => {
    const api = fakeApi({
      'GET /agent_bots': [bot(1), bot(2)],
      'GET /inboxes/10/members': [],
      'POST /inboxes/10/agent_bot': (body) => {
        if ((body as { agent_bot_id: number | null }).agent_bot_id === 2) throw status(404, 'Robô removido');
        return inbox;
      },
    });
    const { user, onChange } = renderSettings('inboxes', 10, {
      ...catalog,
      inboxes: [{ ...inbox, agent_bot_id: 1 }],
    });
    const select = await screen.findByLabelText('Robô de atendimento');
    expect(screen.getByText(/começam como “Pendente”/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Atendimento por IA (MCP)' })).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Robô 2' });
    expect(select).toHaveValue('1');
    await user.selectOptions(select, '');
    await waitFor(() =>
      expect(api.called('POST', '/inboxes/10/agent_bot')[0].body).toEqual({ agent_bot_id: null }),
    );
    expect(onChange).toHaveBeenCalled();
    await user.selectOptions(select, '2');
    expect(await screen.findByText('Robô removido')).toBeInTheDocument();
  });
});
