import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactsPage } from '../../src/agent/ContactsPage';
import type { User } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, contact, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const other = { ...contact, id: 51, name: 'Outro', phone_number: '+5511900000000', conversations: [] };

function renderPage(user: User = admin) {
  const onOpen = vi.fn();
  render(<ContactsPage onOpenConversation={onOpen} user={user} catalog={catalog} />);
  return { onOpen, user: userEvent.setup() };
}

describe('contacts book', () => {
  it('creates, imports and exports contacts', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const created = { ...contact, id: 52, name: 'Ana', conversations: [] };
    const api = fakeApi({
      'GET /contacts': [contact],
      'POST /contacts': (body) => {
        if ((body as { name?: string }).name === 'Repetida') throw status(422, 'Telefone já cadastrado');
        return created;
      },
      'GET /contacts/52': created,
      'POST /contacts/import': { created: 2, updated: 1, failed: [{ line: 3, error: 'Telefone inválido' }] },
      'GET /contacts/export': () => 'name,phone_number',
    });
    const { user } = renderPage();
    expect(await screen.findByText('1 contato')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo contato' }));
    let dialog = screen.getByRole('dialog', { name: 'Novo contato' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Repetida');
    await user.click(within(dialog).getByRole('button', { name: 'Criar contato' }));
    expect(await within(dialog).findByText('Telefone já cadastrado')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Nome'));
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana');
    await user.type(within(dialog).getByLabelText('Telefone'), ' 11 99999-0000 ');
    await user.click(within(dialog).getByRole('button', { name: 'Criar contato' }));
    expect(await screen.findByRole('dialog', { name: 'Ana' })).toBeInTheDocument();
    expect(api.called('POST', '/contacts')[1].body).toEqual({ name: 'Ana', phone_number: '11 99999-0000' });
    expect(screen.getByText('2 contatos')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }));

    await user.click(screen.getByRole('button', { name: 'Importar' }));
    dialog = screen.getByRole('dialog', { name: 'Importar contatos' });
    const file = new File(['name,phone_number\nAna,11'], 'contatos.csv', { type: 'text/csv' });
    expect(within(dialog).getByRole('button', { name: 'Importar' })).toBeDisabled();
    await user.upload(within(dialog).getByLabelText('Arquivo CSV'), file);
    await user.click(within(dialog).getByRole('button', { name: 'Importar' }));
    expect(await within(dialog).findByText('2 criado(s), 1 atualizado(s), 1 com erro.')).toBeInTheDocument();
    expect(within(dialog).getByText('Linha 3: Telefone inválido')).toBeInTheDocument();
    const form = api.called('POST', '/contacts/import')[0].body as FormData;
    expect((form.get('import_file') as File).name).toBe('contatos.csv');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    api.route('GET /contacts/export', () => {
      throw status(403, 'Somente administradores');
    });
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Somente administradores');
  });

  it('edits phone, photo, labels, notes and blocking in the contact detail', async () => {
    const full = { ...contact, labels: ['vip'], avatar_url: 'https://pps.whatsapp.net/a.jpg' };
    let notes = [
      { id: 1, contact_id: 50, user_id: 1, user_name: 'Admin', content: 'Cliente antigo', created_at: 1 },
    ];
    const api = fakeApi({
      'GET /contacts': [contact],
      'GET /contacts/50': full,
      'GET /contacts/50/notes': () => notes,
      'POST /contacts/50/notes': (body) => {
        if ((body as { content: string }).content === 'erro') throw status(422, 'Nota inválida');
        return { ...notes[0], id: 2, user_name: null, ...(body as object) };
      },
      'DELETE /contacts/50/notes/1': () => {
        notes = [];
        return { ok: true };
      },
      'POST /contacts/50/avatar': { ...full, avatar_url: null },
      'PATCH /contacts/50': (body) => ({
        ...full,
        ...(body as object),
        blocked: (body as { blocked?: boolean }).blocked ? 1 : 0,
      }),
      'POST /contacts/50/labels': (body) => ({ ...full, ...(body as object) }),
    });
    const { user } = renderPage();
    await user.click(await screen.findByText('João Cliente'));
    const panel = await screen.findByRole('dialog', { name: 'João Cliente' });
    expect(within(panel).getByAltText('Foto do contato')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Atualizar foto' }));
    await waitFor(() => expect(within(panel).queryByAltText('Foto do contato')).not.toBeInTheDocument());

    const phone = within(panel).getByLabelText('Telefone');
    await user.clear(phone);
    await user.type(phone, '+55 11 97777-6666');
    await user.click(within(panel).getByRole('button', { name: 'Salvar contato' }));
    expect(await within(panel).findByText('Contato salvo.')).toBeInTheDocument();
    expect(api.called('PATCH', '/contacts/50')[0].body).toEqual({
      name: 'João Cliente',
      email: 'joao@example.com',
      phone_number: '+55 11 97777-6666',
    });

    await user.click(within(panel).getByRole('button', { name: 'Remover etiqueta vip' }));
    await user.click(within(panel).getByRole('button', { name: 'Adicionar etiqueta' }));
    await user.click(screen.getByRole('menuitem', { name: 'financeiro' }));
    await waitFor(() =>
      expect(api.called('POST', '/contacts/50/labels').map((c) => c.body)).toEqual([
        { labels: [] },
        { labels: ['financeiro'] },
      ]),
    );

    expect(await within(panel).findByText('Cliente antigo')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Nova nota'), 'erro');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar nota' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Nota inválida');
    await user.clear(within(panel).getByLabelText('Nova nota'));
    await user.type(within(panel).getByLabelText('Nova nota'), 'Ligar amanhã');
    await user.click(within(panel).getByRole('button', { name: 'Adicionar nota' }));
    expect(await within(panel).findByText('Ligar amanhã')).toBeInTheDocument();
    expect(within(panel).getByText(/Sistema/)).toBeInTheDocument();
    await user.click(within(panel).getAllByRole('button', { name: 'Excluir nota' })[1]);
    await waitFor(() => expect(within(panel).queryByText('Cliente antigo')).not.toBeInTheDocument());

    await user.click(within(panel).getByRole('button', { name: 'Bloquear' }));
    expect(await within(panel).findByRole('button', { name: 'Desbloquear' })).toBeInTheDocument();
    expect(within(panel).getByText('Bloqueado')).toBeInTheDocument();
    expect(api.called('PATCH', '/contacts/50')[1].body).toEqual({ blocked: true });
    api.route('PATCH /contacts/50', () => {
      throw status(502, 'WhatsApp indisponível');
    });
    await user.click(within(panel).getByRole('button', { name: 'Desbloquear' }));
    expect(await within(panel).findByText('WhatsApp indisponível')).toBeInTheDocument();
  });

  it('starts a conversation, merges and deletes a contact', async () => {
    const api = fakeApi({
      'GET /contacts': (_b: unknown, url: URL) =>
        url.searchParams.get('q') ? [contact, other] : [contact, other],
      'GET /contacts/50': contact,
      'GET /contacts/51': other,
      'POST /conversations': { id: 300, display_id: 12 },
      'POST /actions/contact_merge': other,
      'DELETE /contacts/51': { ok: true },
    });
    const { user, onOpen } = renderPage();
    await user.click(await screen.findByText('João Cliente'));
    let panel = await screen.findByRole('dialog', { name: 'João Cliente' });
    await user.click(within(panel).getByRole('button', { name: 'Nova conversa' }));
    let dialog = screen.getByRole('dialog', { name: 'Nova conversa' });
    await user.type(within(dialog).getByLabelText('Mensagem'), 'Olá!');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(12));
    expect(api.called('POST', '/conversations')[0].body).toEqual({
      contact_id: 50,
      inbox_id: 10,
      message: { content: 'Olá!' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(within(panel).getByRole('button', { name: 'Mesclar' }));
    dialog = screen.getByRole('dialog', { name: 'Mesclar contato' });
    expect(within(dialog).getByRole('button', { name: 'Mesclar' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Pesquisar contato para mesclar'), 'Out');
    await user.click(await within(dialog).findByRole('button', { name: /Outro/ }));
    expect(within(dialog).getByText(/será mesclado em “Outro”/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));
    panel = await screen.findByRole('dialog', { name: 'Outro' });
    expect(api.called('POST', '/actions/contact_merge')[0].body).toEqual({
      base_contact_id: 51,
      mergee_contact_id: 50,
    });

    await user.click(within(panel).getByRole('button', { name: 'Excluir contato' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Excluir contato' })).getByRole('button', {
        name: 'Excluir',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Outro')).not.toBeInTheDocument();
  });

  it('hides administrator tools from agents', async () => {
    fakeApi({ 'GET /contacts': [contact], 'GET /contacts/50': contact });
    const { user } = renderPage(maria);
    await user.click(await screen.findByText('João Cliente'));
    const panel = await screen.findByRole('dialog', { name: 'João Cliente' });
    expect(within(panel).queryByRole('button', { name: 'Excluir contato' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();
  });
});
