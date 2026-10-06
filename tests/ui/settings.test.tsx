import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/agent/settings/SettingsPage';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, { ...maria, active: 0 }], teams: [team], labels };
function renderSettings(current = catalog) {
  const onChange = vi.fn(async () => {});
  render(<SettingsPage user={admin} catalog={current} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe('settings', () => {
  it('creates agents, changes roles and toggles activation', async () => {
    const api = fakeApi({
      'POST /agents': (body) => {
        if ((body as { email: string }).email === 'dup@example.com')
          throw status(409, 'E-mail já cadastrado');
        return { id: 3 };
      },
      'PATCH /agents/2': {},
    });
    const { onChange, user } = renderSettings();
    await user.selectOptions(screen.getByLabelText('Papel de Maria Souza'), 'administrator');
    await user.click(screen.getByRole('button', { name: 'Reativar' }));
    expect(api.called('PATCH', '/agents/2').map((c) => c.body)).toEqual([
      { role: 'administrator' },
      { active: true },
    ]);
    expect(screen.getByLabelText('Papel de Admin')).toBeDisabled();

    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'dup@example.com');
    await user.type(screen.getByLabelText(/Senha inicial/), 'senha-segura-123');
    await user.selectOptions(screen.getByLabelText('Papel'), 'agent');
    await user.click(screen.getByLabelText('Suporte'));
    await user.click(screen.getByRole('button', { name: 'Criar agente' }));
    expect(await screen.findByText('E-mail já cadastrado')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('E-mail'));
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.click(screen.getByLabelText('Suporte'));
    await user.click(screen.getByLabelText('Suporte'));
    await user.click(screen.getByRole('button', { name: 'Criar agente' }));
    await waitFor(() => expect(api.called('POST', '/agents')).toHaveLength(2));
    expect(api.called('POST', '/agents')[1].body).toMatchObject({
      email: 'ana@example.com',
      inbox_ids: [10],
    });
    expect(onChange).toHaveBeenCalled();
  });

  it('edits inbox flags, name and members', async () => {
    const api = fakeApi({
      'GET /inboxes/10/members': [admin],
      'POST /inboxes/10/members': [admin, maria],
      'DELETE /inboxes/10/members': [maria],
      'PATCH /inboxes/10': {},
    });
    const { user } = renderSettings({ ...catalog, agents: [admin, maria] });
    await user.click(screen.getByRole('tab', { name: 'Caixas de entrada' }));
    expect(await screen.findByText('+5511999999999 · connected')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Admin/ })).toBeChecked());
    await user.click(screen.getByRole('checkbox', { name: /Atendimento por IA/ }));
    await user.click(screen.getByRole('checkbox', { name: /Ignorar grupos/ }));
    const name = screen.getByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'Vendas');
    await user.click(screen.getByRole('button', { name: 'Renomear' }));
    expect(api.called('PATCH', '/inboxes/10').map((c) => c.body)).toEqual([
      { agent_bot_enabled: true },
      { ignore_groups: false },
      { name: 'Vendas' },
    ]);
    await user.click(screen.getByRole('checkbox', { name: /Maria Souza/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Maria Souza/ })).toBeChecked());
    await user.click(screen.getByRole('checkbox', { name: /Admin/ }));
    await waitFor(() =>
      expect(api.called('DELETE', '/inboxes/10/members')[0].body).toEqual({ user_ids: [1] }),
    );
  });

  it('creates teams, edits members and auto-assign, and deletes them', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = fakeApi({
      'POST /teams': { id: 5, name: 'Financeiro' },
      'GET /teams/5/members': [],
      'POST /teams/5/members': [admin],
      'DELETE /teams/5/members': [],
      'PATCH /teams/5': {},
      'DELETE /teams/5': { ok: true },
    });
    const { user } = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Times' }));
    await user.type(screen.getByLabelText('Novo time'), 'Financeiro');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    const editor = (await screen.findByRole('heading', { name: 'Financeiro' })).closest('section')!;
    await user.click(within(editor).getByRole('checkbox', { name: /Atribuição automática no time/ }));
    expect(api.called('PATCH', '/teams/5')[0].body).toEqual({ allow_auto_assign: false });
    await user.click(within(editor).getByRole('checkbox', { name: 'Admin' }));
    await waitFor(() => expect(within(editor).getByRole('checkbox', { name: 'Admin' })).toBeChecked());
    await user.click(within(editor).getByRole('checkbox', { name: 'Admin' }));
    await waitFor(() => expect(api.called('DELETE', '/teams/5/members')).toHaveLength(1));
    await user.click(within(editor).getByRole('button', { name: /Excluir time/ }));
    expect(api.called('DELETE', '/teams/5')).toHaveLength(0);
    await user.click(within(editor).getByRole('button', { name: /Excluir time/ }));
    await waitFor(() => expect(api.called('DELETE', '/teams/5')).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: 'Financeiro' })).not.toBeInTheDocument();
  });

  it('creates and deletes labels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = fakeApi({ 'POST /labels': {}, 'DELETE /labels/1': { ok: true } });
    const { user } = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Etiquetas' }));
    expect(screen.getByText('Clientes VIP')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nome \(vira minúsculas/), 'Urgente');
    await user.click(screen.getByRole('button', { name: 'Criar etiqueta' }));
    await waitFor(() =>
      expect(api.called('POST', '/labels')[0].body).toEqual({
        title: 'Urgente',
        description: null,
        color: '#1f93ff',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Excluir vip' }));
    await waitFor(() => expect(api.called('DELETE', '/labels/1')).toHaveLength(1));
  });

  it('creates and deletes canned responses', async () => {
    let items = [{ id: 1, short_code: 'oi', content: 'Olá!' }];
    const api = fakeApi({
      'GET /canned_responses': () => items,
      'POST /canned_responses': (body) => {
        items = [...items, { id: 2, ...(body as { short_code: string; content: string }) }];
        return items[1];
      },
      'DELETE /canned_responses/1': () => {
        items = items.slice(1);
        return { ok: true };
      },
    });
    const { user } = renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Respostas prontas' }));
    expect(await screen.findByText('/oi')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Atalho'), 'prazo');
    await user.type(screen.getByLabelText('Texto'), '3 dias úteis');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('/prazo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Excluir /oi' }));
    await waitFor(() => expect(screen.queryByText('/oi')).not.toBeInTheDocument());
    expect(api.called('POST', '/canned_responses')[0].body).toEqual({
      short_code: 'prazo',
      content: '3 dias úteis',
    });
  });
});
