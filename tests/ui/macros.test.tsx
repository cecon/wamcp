import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import { ContactPanel } from '../../src/agent/conversations/ContactPanel';
import { ConversationsScreen } from '../../src/agent/conversations/ConversationsScreen';
import { connectRealtime } from '../../src/agent/api';
import type { Macro } from '../../src/agent/accountTypes';
import type { User } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, contact, conversation, inbox, labels, maria, team, workspaceRoutes } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const triage: Macro = {
  id: 1,
  name: 'Triagem',
  visibility: 'global',
  created_by: 1,
  created_by_name: 'Admin',
  actions: [
    { action_name: 'add_label', action_params: ['vip'] },
    { action_name: 'resolve_conversation', action_params: [] },
  ],
};
const mine: Macro = {
  ...triage,
  id: 2,
  name: 'Minha',
  visibility: 'personal',
  created_by: 2,
  created_by_name: null,
  actions: [{ action_name: 'mute_conversation', action_params: [] }],
};

function macroStore(initial: Macro[]) {
  let macros = initial;
  return {
    'GET /macros': () => macros,
    'POST /macros': (body: unknown) => {
      const draft = body as Macro;
      if (draft.name === 'falha') throw status(422, 'Informe o parâmetro da ação');
      macros = [...macros, { ...draft, id: 3, created_by: 1, created_by_name: 'Admin' }];
      return macros.at(-1)!;
    },
    'PATCH /macros/1': (body: unknown) => {
      macros = macros.map((m) => (m.id === 1 ? { ...m, ...(body as object) } : m));
      return macros[0];
    },
    'DELETE /macros/2': () => {
      macros = macros.filter((m) => m.id !== 2);
      return { ok: true };
    },
  };
}
const renderPage = (user: User) => {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'macros' }}
      user={user}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
};

describe('macros settings', () => {
  it('creates, edits and deletes macros with the shared action editor', async () => {
    const api = fakeApi(macroStore([triage, mine]));
    const user = renderPage(admin);
    expect(await screen.findByText('Adicionar etiqueta → Resolver conversa')).toBeInTheDocument();
    expect(screen.getByText('Pública')).toBeInTheDocument();
    expect(screen.getByText('Privada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar macro' }));
    let panel = screen.getByRole('dialog', { name: 'Adicionar macro' });
    await user.type(within(panel).getByLabelText('Nome da macro'), 'falha');
    await user.click(within(panel).getByRole('button', { name: 'Salvar macro' }));
    expect(await within(panel).findByText('Informe o parâmetro da ação')).toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('Nome da macro'));
    await user.type(within(panel).getByLabelText('Nome da macro'), 'Encerrar');
    await user.click(within(panel).getByRole('radio', { name: /Pública/ }));
    await user.selectOptions(within(panel).getByLabelText('Ação 1'), 'change_priority');
    await user.selectOptions(within(panel).getByLabelText('Parâmetro 1'), 'urgent');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar ação' }));
    await user.selectOptions(within(panel).getByLabelText('Ação 2'), 'snooze_conversation');
    expect(within(panel).queryByLabelText('Parâmetro 2')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Salvar macro' }));
    expect(await screen.findByText('Encerrar')).toBeInTheDocument();
    expect(api.called('POST', '/macros')[1].body).toEqual({
      name: 'Encerrar',
      visibility: 'global',
      actions: [
        { action_name: 'change_priority', action_params: ['urgent'] },
        { action_name: 'snooze_conversation', action_params: [] },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Editar Triagem' }));
    panel = screen.getByRole('dialog', { name: 'Editar macro' });
    expect(within(panel).getByLabelText('Nome da macro')).toHaveValue('Triagem');
    await user.click(within(panel).getByRole('button', { name: 'Remover ação 2' }));
    await user.click(within(panel).getByRole('button', { name: 'Salvar macro' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/macros/1')[0].body).toEqual({
        name: 'Triagem',
        visibility: 'global',
        actions: [{ action_name: 'add_label', action_params: ['vip'] }],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Excluir Minha' }));
    const confirm = screen.getByRole('dialog', { name: 'Excluir macro' });
    await user.click(within(confirm).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(screen.queryByText('Minha')).not.toBeInTheDocument());
    await user.type(screen.getByLabelText('Pesquisar macros…'), 'zzz');
    expect(screen.getByText('Nenhuma macro encontrada.')).toBeInTheDocument();
  });

  it('lets agents manage only personal macros', async () => {
    fakeApi(macroStore([triage, mine]));
    const user = renderPage(maria);
    expect(await screen.findByText('Minha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Triagem' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar Minha' }));
    const panel = screen.getByRole('dialog', { name: 'Editar macro' });
    expect(within(panel).getByRole('radio', { name: /Pública/ })).toBeDisabled();
    expect(
      within(panel).getByText('Somente administradores podem criar macros públicas.'),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows load failures', async () => {
    fakeApi({
      'GET /macros': () => {
        throw status(500, 'Falha ao carregar macros');
      },
    });
    renderPage(admin);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar macros');
  });
});

describe('running macros', () => {
  it('runs a macro from the conversation panel and reports failures', async () => {
    let run = 0;
    const api = fakeApi({
      'GET /contacts/50': contact,
      'GET /macros': [triage],
      'GET /conversations/7': { ...conversation, status: 'resolved' },
      'POST /macros/1/execute': () => {
        run++;
        if (run === 2) return { updated: [], failed: [{ id: 7, error: 'Etiqueta inexistente' }] };
        if (run === 3) throw status(404, 'Macro não encontrada');
        return { updated: [7], failed: [] };
      },
    });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactPanel
        conversation={conversation}
        user={admin}
        catalog={catalog}
        onChange={onChange}
        onError={vi.fn()}
        onOpenConversation={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Macros' }));
    const runButton = await screen.findByRole('button', { name: 'Executar Triagem' });
    await user.click(runButton);
    expect(await screen.findByRole('status')).toHaveTextContent('Macro “Triagem” executada com sucesso.');
    expect(api.called('POST', '/macros/1/execute')[0].body).toEqual({ conversation_ids: [7] });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' })),
    );
    await user.click(runButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Falha ao executar “Triagem”: Etiqueta inexistente',
    );
    await user.click(runButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('Macro não encontrada');
  });

  it('explains when there are no macros', async () => {
    fakeApi({ 'GET /contacts/50': contact, 'GET /macros': [] });
    const user = userEvent.setup();
    render(
      <ContactPanel
        conversation={conversation}
        user={admin}
        catalog={catalog}
        onChange={vi.fn()}
        onError={vi.fn()}
        onOpenConversation={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Macros' }));
    expect(await screen.findByText(/Nenhuma macro disponível/)).toBeInTheDocument();
  });

  it('runs a macro on the selected conversations from the bulk action bar', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /conversations': [conversation, { ...conversation, id: 101, display_id: 8 }],
      'GET /macros': [triage],
      'POST /macros/1/execute': { updated: [7], failed: [{ id: 8, error: 'Sem acesso à caixa' }] },
    });
    const user = userEvent.setup();
    render(
      <ConversationsScreen
        route={{ page: 'conversations' }}
        user={admin}
        catalog={catalog}
        realtime={connectRealtime(() => {})}
        onNavigate={vi.fn()}
      />,
    );
    await user.click(await screen.findByLabelText('Selecionar conversa #7'));
    const bar = screen.getByRole('toolbar', { name: 'Ações em massa' });
    await user.click(within(bar).getByLabelText('Selecionar todas'));
    await user.click(await within(bar).findByRole('button', { name: 'Executar macro' }));
    await user.click(screen.getByRole('menuitem', { name: 'Triagem' }));
    expect(await screen.findByText('#8: Sem acesso à caixa')).toBeInTheDocument();
    expect(api.called('POST', '/macros/1/execute')[0].body).toEqual({ conversation_ids: [7, 8] });
    expect(screen.getByText('1 selecionada(s)')).toBeInTheDocument();
  });
});
