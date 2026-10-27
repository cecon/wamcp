import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { CustomRole } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { SettingsSection } from '../../src/agent/route';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const supervisor: CustomRole = {
  id: 4,
  name: 'Supervisor',
  description: 'Vê tudo',
  permissions: ['conversation_manage', 'report_manage'],
  agent_role: null,
  builtin: false,
};
const empty: CustomRole = {
  id: 5,
  name: 'Restrito',
  description: null,
  permissions: [],
  agent_role: null,
  builtin: false,
};
const padrao: CustomRole = {
  id: 1,
  name: 'Padrão',
  description: null,
  permissions: ['conversation_manage'],
  agent_role: null,
  builtin: true,
};
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
      agent_role: null,
      skill_ids: [],
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
        agent_role: null,
        skill_ids: [],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Excluir Restrito' }));
    const confirm = screen.getByRole('dialog', { name: 'Excluir o perfil “Restrito”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(screen.queryByText('Restrito')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('sets the AI role of a profile and keeps Padrão undeletable', async () => {
    const api = fakeApi({
      'GET /custom_roles': [padrao, supervisor],
      'POST /custom_roles': (body) => ({ ...(body as CustomRole), id: 8, builtin: false }),
    });
    const { user } = renderSettings('custom_roles');
    expect(await screen.findByText('Padrão')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir Padrão' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir Supervisor' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar perfil' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar perfil' });
    await user.type(within(dialog).getByLabelText('Nome do perfil'), 'Coordenação');
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'coordinator');
    await user.click(within(dialog).getByLabelText('Gerenciar contatos'));
    await user.click(within(dialog).getByRole('button', { name: 'Criar perfil' }));
    await waitFor(() => expect(api.called('POST', '/custom_roles')).toHaveLength(1));
    expect(api.called('POST', '/custom_roles')[0].body).toMatchObject({ agent_role: 'coordinator' });
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
