import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationsScreen } from '../../src/agent/conversations/ConversationsScreen';
import { ContactPanel } from '../../src/agent/conversations/ContactPanel';
import { connectRealtime } from '../../src/agent/api';
import type { User } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, conversation, inbox, labels, maria, team, workspaceRoutes } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

function renderScreen(route: Record<string, unknown> = {}, user: User = admin) {
  const onNavigate = vi.fn();
  render(
    <ConversationsScreen
      route={{ page: 'conversations', ...route }}
      user={user}
      catalog={catalog}
      realtime={connectRealtime(() => {})}
      onNavigate={onNavigate}
    />,
  );
  return { onNavigate, user: userEvent.setup() };
}

describe('chat list power features', () => {
  it('scopes by conversation type, sorts and marks muted conversations', async () => {
    const api = fakeApi({ ...workspaceRoutes(), 'GET /conversations': [{ ...conversation, muted: 1 }] });
    const { user } = renderScreen({ conversationType: 'mentions' });
    expect(await screen.findByRole('heading', { name: 'Menções' })).toBeInTheDocument();
    expect(screen.getByLabelText('Conversa silenciada')).toBeInTheDocument();
    const first = api.called('GET', '/conversations')[0].search;
    expect(first).toContain('conversation_type=mentions');
    expect(first).toContain('sort_by=last_activity_at_desc');
    expect(api.called('GET', '/conversations/meta')[0].search).toContain('conversation_type=mentions');
    await user.click(screen.getByRole('button', { name: 'Ordenar conversas' }));
    await user.selectOptions(screen.getByRole('combobox'), 'priority_desc');
    await waitFor(() =>
      expect(api.called('GET', '/conversations').at(-1)!.search).toContain('sort_by=priority_desc'),
    );
  });

  it('applies bulk actions to the selection and lists failures', async () => {
    let call = 0;
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations': [conversation, { ...conversation, id: 101, display_id: 8 }],
      'POST /bulk_actions': () => {
        call++;
        if (call === 1) return { updated: [7], failed: [{ id: 8, error: 'Sem acesso à caixa' }] };
        if (call === 7) throw status(422, 'Selecione até 100 conversas');
        return { updated: [], failed: [] };
      },
    });
    const { user } = renderScreen();
    await user.click(await screen.findByLabelText('Selecionar conversa #7'));
    const bar = screen.getByRole('toolbar', { name: 'Ações em massa' });
    expect(within(bar).getByText('1 selecionada(s)')).toBeInTheDocument();
    await user.click(within(bar).getByLabelText('Selecionar todas'));
    expect(within(bar).getByText('2 selecionada(s)')).toBeInTheDocument();
    const pick = async (menu: string, item: string) => {
      await user.click(within(screen.getByRole('toolbar')).getByRole('button', { name: menu }));
      await user.click(screen.getByRole('menuitem', { name: item }));
    };
    await pick('Alterar status', 'Resolver');
    expect(await screen.findByText('#8: Sem acesso à caixa')).toBeInTheDocument();
    expect(screen.getByText('1 selecionada(s)')).toBeInTheDocument();
    await pick('Alterar status', 'Adiar até amanhã');
    await pick('Atribuir agente', 'Remover agente');
    await pick('Atribuir time', 'Financeiro');
    await pick('Alterar prioridade', 'Alta');
    await pick('Etiquetas', 'Adicionar vip');
    await pick('Etiquetas', 'Remover financeiro');
    expect(await screen.findByText('Selecione até 100 conversas')).toBeInTheDocument();
    const bodies = api.called('POST', '/bulk_actions').map((c) => c.body as Record<string, unknown>);
    expect(bodies[0]).toEqual({ ids: [7, 8], fields: { status: 'resolved' } });
    expect((bodies[1].fields as { snoozed_until: number }).snoozed_until).toBeGreaterThan(Date.now() / 1000);
    expect(bodies.slice(2).map((b) => [b.fields, b.labels])).toEqual([
      [{ assignee_id: null }, undefined],
      [{ team_id: 5 }, undefined],
      [{ priority: 'high' }, undefined],
      [undefined, { add: ['vip'] }],
      [undefined, { remove: ['financeiro'] }],
    ]);
    expect(api.called('GET', '/conversations').length).toBeGreaterThan(2);
    await user.click(screen.getByLabelText('Selecionar todas'));
    await user.click(screen.getByLabelText('Selecionar todas'));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Selecionar conversa #8'));
    await user.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    await user.click(screen.getByLabelText('Selecionar conversa #7'));
    await user.click(screen.getByLabelText('Selecionar conversa #7'));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});

describe('conversation header menu', () => {
  it('mutes, unmutes, downloads the transcript, marks unread and deletes', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = fakeApi({
      ...workspaceRoutes(),
      'POST /conversations/7/mute': { ...conversation, muted: 1 },
      'POST /conversations/7/unmute': { ...conversation, muted: 0 },
      'GET /conversations/7/transcript': () => 'transcrição',
      'POST /conversations/7/unread': { ...conversation },
      'DELETE /conversations/7': () => {
        throw status(403, 'Somente administradores');
      },
    });
    const { user, onNavigate } = renderScreen({ displayId: 7 });
    const box = await screen.findByRole('region', { name: 'Conversa' });
    const choose = async (item: string) => {
      await user.click(within(box).getByRole('button', { name: 'Mais ações' }));
      await user.click(screen.getByRole('menuitem', { name: item }));
    };
    await choose('Silenciar conversa');
    expect(await within(box).findByLabelText('Conversa silenciada')).toBeInTheDocument();
    await choose('Reativar notificações');
    await waitFor(() => expect(within(box).queryByLabelText('Conversa silenciada')).not.toBeInTheDocument());
    await choose('Baixar transcrição');
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.called('GET', '/conversations/7/transcript')).toHaveLength(1);
    await choose('Marcar como não lida');
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({ page: 'conversations', displayId: undefined }),
    );
    await choose('Excluir conversa');
    const dialog = screen.getByRole('dialog', { name: 'Excluir conversa' });
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Somente administradores');
    api.route('DELETE /conversations/7', { ok: true });
    onNavigate.mockClear();
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({ page: 'conversations', displayId: undefined }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports failures and hides deletion from agents', async () => {
    fakeApi({
      ...workspaceRoutes(maria),
      'GET /conversations/7/transcript': () => {
        throw status(404, 'Conversa não encontrada');
      },
    });
    const { user } = renderScreen({ displayId: 7 }, maria);
    const box = await screen.findByRole('region', { name: 'Conversa' });
    await user.click(within(box).getByRole('button', { name: 'Mais ações' }));
    expect(screen.queryByRole('menuitem', { name: 'Excluir conversa' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Baixar transcrição' }));
    expect(await within(box).findByText('Conversa não encontrada')).toBeInTheDocument();
  });
});

describe('participants', () => {
  it('lists, joins, adds and removes participants', async () => {
    const byId = { 1: admin, 2: maria } as Record<number, User>;
    const api = fakeApi({
      'GET /contacts/50': () => {
        throw status(404, 'x');
      },
      'GET /conversations/7/participants': [maria],
      'PATCH /conversations/7/participants': (body) => {
        const ids = (body as { user_ids: number[] }).user_ids;
        if (ids.length === 0) throw status(422, 'Agente sem acesso');
        return ids.map((id) => byId[id]);
      },
    });
    const onError = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactPanel
        conversation={conversation}
        user={admin}
        catalog={{ ...catalog, agents: [admin, { ...maria, inbox_ids: [10] }] }}
        onChange={vi.fn()}
        onError={onError}
        onOpenConversation={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Participantes da conversa' }));
    expect(await screen.findByText('1 participante')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Participar' }));
    expect(await screen.findByRole('button', { name: 'Deixar de participar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar participante' }));
    expect(screen.getByText('Nenhum agente disponível.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover participante Maria Souza' }));
    await waitFor(() => expect(screen.getByText('1 participante')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Adicionar participante' }));
    await user.click(screen.getByRole('menuitem', { name: 'Maria Souza' }));
    await waitFor(() => expect(screen.getByText('2 participantes')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Deixar de participar' }));
    await user.click(await screen.findByRole('button', { name: 'Remover participante Maria Souza' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Agente sem acesso'));
    expect(api.called('PATCH', '/conversations/7/participants').map((c) => c.body)).toEqual([
      { user_ids: [2, 1] },
      { user_ids: [1] },
      { user_ids: [1, 2] },
      { user_ids: [2] },
      { user_ids: [] },
    ]);
  });
});
