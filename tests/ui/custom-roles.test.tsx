import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { CustomRole } from '../../src/agent/adminTypes';
import type { Catalog, User } from '../../src/agent/types';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const supervisor: CustomRole = {
  id: 4,
  name: 'Supervisor',
  description: 'Vê tudo',
  permissions: ['conversation_manage', 'report_manage'],
};
const empty: CustomRole = { id: 5, name: 'Restrito', description: null, permissions: [] };
const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

function renderSettings(section: SettingsSection, current = catalog) {
  const onChange = vi.fn(async () => {});
  render(
    <SettingsRouter
      route={{ page: 'settings', section }}
      user={admin}
      catalog={current}
      onNavigate={vi.fn()}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('custom roles settings', () => {
  it('lists, creates, edits and deletes roles', async () => {
    let roles = [supervisor, empty];
    const api = fakeApi({
      'GET /custom_roles': () => roles,
      'POST /custom_roles': (body) => {
        if ((body as { name: string }).name === 'Supervisor') throw status(409, 'Nome já usado');
        roles = [...roles, { ...(body as CustomRole), id: 6 }];
        return roles[2];
      },
      'PUT /custom_roles/4': (body) => ({ ...supervisor, ...(body as object) }),
      'DELETE /custom_roles/5': () => {
        roles = roles.filter((r) => r.id !== 5);
        return { ok: true };
      },
    });
    const { user, onChange } = renderSettings('custom_roles');
    expect(await screen.findByText('Supervisor')).toBeInTheDocument();
    expect(screen.getByText('Gerenciar todas as conversas, Ver relatórios')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma permissão')).toBeInTheDocument();
    expect(screen.getByText('2 perfis')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar perfil' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar perfil' });
    await user.type(within(dialog).getByLabelText('Nome do perfil'), 'Supervisor');
    await user.click(within(dialog).getByRole('button', { name: 'Criar perfil' }));
    expect(await within(dialog).findByText('Nome já usado')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Nome do perfil'));
    await user.type(within(dialog).getByLabelText('Nome do perfil'), 'Contatos');
    await user.type(within(dialog).getByLabelText('Descrição'), 'Só contatos');
    await user.click(within(dialog).getByLabelText('Gerenciar contatos'));
    await user.click(within(dialog).getByLabelText('Conversas sem responsável e as próprias'));
    await user.click(within(dialog).getByLabelText('Conversas sem responsável e as próprias'));
    await user.click(within(dialog).getByLabelText('Conversas em que participa e as próprias'));
    await user.click(within(dialog).getByRole('button', { name: 'Criar perfil' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.called('POST', '/custom_roles')[1].body).toEqual({
      name: 'Contatos',
      description: 'Só contatos',
      permissions: ['contact_manage', 'conversation_participating_manage'],
    });
    expect(await screen.findByText('3 perfis')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar Supervisor' }));
    const edit = screen.getByRole('dialog', { name: 'Editar perfil' });
    expect(within(edit).getByLabelText('Ver relatórios')).toBeChecked();
    await user.click(within(edit).getByLabelText('Ver relatórios'));
    await user.click(within(edit).getByRole('button', { name: 'Atualizar perfil' }));
    await waitFor(() =>
      expect(api.called('PUT', '/custom_roles/4')[0].body).toEqual({
        name: 'Supervisor',
        description: 'Vê tudo',
        permissions: ['conversation_manage'],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Excluir Restrito' }));
    const confirm = screen.getByRole('dialog', { name: 'Excluir o perfil “Restrito”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(screen.queryByText('Restrito')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('shows the error when roles cannot be loaded', async () => {
    fakeApi({
      'GET /custom_roles': () => {
        throw status(403, 'Acesso negado');
      },
    });
    renderSettings('custom_roles');
    expect(await screen.findByText('Acesso negado')).toBeInTheDocument();
    expect(screen.getByText('0 perfis')).toBeInTheDocument();
  });
});

describe('agent profile', () => {
  const ana: User = { ...maria, id: 3, name: 'Ana', email: 'ana@example.com', custom_role_id: 4 };
  const ghost: User = { ...maria, id: 7, name: 'Bia', email: 'bia@example.com', custom_role_id: 99 };
  const agents = { ...catalog, agents: [admin, maria, ana, ghost] };

  it('shows each agent role and changes it with the Perfil selector', async () => {
    const api = fakeApi({
      'GET /custom_roles': [supervisor, empty],
      'PATCH /agents/2': {},
      'PATCH /agents/3': {},
    });
    const { user } = renderSettings('agents', agents);
    expect(await screen.findByText('Supervisor')).toBeInTheDocument();
    expect(screen.getByText('Perfil personalizado')).toBeInTheDocument();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('Agente')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar Maria Souza' }));
    const edit = screen.getByRole('dialog', { name: 'Editar Maria Souza' });
    expect(within(edit).getByLabelText('Perfil')).toHaveValue('');
    await user.selectOptions(within(edit).getByLabelText('Perfil'), 'Restrito');
    await user.click(within(edit).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/agents/2')[0].body).toEqual({
        name: 'Maria Souza',
        role: 'agent',
        custom_role_id: 5,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Editar Ana' }));
    const back = screen.getByRole('dialog', { name: 'Editar Ana' });
    expect(within(back).getByLabelText('Perfil')).toHaveValue('4');
    await user.selectOptions(within(back).getByLabelText('Perfil'), 'Agente padrão');
    await user.click(within(back).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.called('PATCH', '/agents/3')[0].body).toEqual({
        name: 'Ana',
        role: 'agent',
        custom_role_id: null,
      }),
    );
  });

  it('assigns a role to a new agent and hides it for administrators', async () => {
    const api = fakeApi({
      'GET /custom_roles': [supervisor],
      'POST /agents': { ...maria, id: 9 },
      'PATCH /agents/9': {},
    });
    const { user } = renderSettings('agents');
    await user.click(screen.getByRole('button', { name: 'Adicionar agente' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar agente' });
    await user.selectOptions(await within(dialog).findByLabelText('Perfil'), 'Supervisor');
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'administrator');
    expect(within(dialog).queryByLabelText('Perfil')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'agent');
    await user.type(within(dialog).getByLabelText('Nome do agente'), 'Caio');
    await user.type(within(dialog).getByLabelText('E-mail'), 'caio@example.com');
    await user.type(within(dialog).getByLabelText(/Senha inicial/), 'senha-segura-123');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar agente' }));
    await waitFor(() => expect(api.called('PATCH', '/agents/9')[0].body).toEqual({ custom_role_id: 4 }));
    expect(api.called('POST', '/agents')[0].body).toMatchObject({ email: 'caio@example.com', role: 'agent' });
  });
});
