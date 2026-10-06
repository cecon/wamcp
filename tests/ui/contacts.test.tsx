import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Contacts } from '../../src/agent/Contacts';
import { fakeApi, status } from './fake-api';
import { conversation } from './fixtures';

const joao = {
  id: 50,
  name: 'João Cliente',
  phone_number: '+5511988887777',
  email: null,
  identifier: null,
  blocked: 0,
  last_activity_at: 1,
};

describe('contacts', () => {
  it('searches, edits a contact and opens one of its conversations', async () => {
    const api = fakeApi({
      'GET /contacts': (_b: unknown, url: URL) =>
        url.searchParams.get('q') === 'zzz' ? [] : [joao, { ...joao, id: 51, name: null }],
      'GET /contacts/50': { ...joao, conversations: [conversation] },
      'PATCH /contacts/50': (body) => ({ ...joao, ...(body as object) }),
    });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<Contacts onOpenConversation={onOpen} />);
    expect(await screen.findByText('João Cliente')).toBeInTheDocument();
    expect(screen.getByText('Selecione um contato.')).toBeInTheDocument();

    await user.click(screen.getByText('João Cliente'));
    const name = await screen.findByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'João Silva');
    await user.type(screen.getByLabelText('E-mail'), 'joao@example.com');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Contato salvo.')).toBeInTheDocument();
    expect(api.called('PATCH', '/contacts/50')[0].body).toEqual({
      name: 'João Silva',
      email: 'joao@example.com',
    });

    await user.click(screen.getByRole('button', { name: /#7 · Suporte · Abertas/ }));
    expect(onOpen).toHaveBeenCalledWith(7);

    await user.type(screen.getByPlaceholderText('Nome, telefone ou e-mail'), 'zzz');
    expect(await screen.findByText('Nenhum contato encontrado.')).toBeInTheDocument();
  });

  it('reports save errors and contacts without visible conversations', async () => {
    fakeApi({
      'GET /contacts': [joao],
      'GET /contacts/50': { ...joao, conversations: [] },
      'PATCH /contacts/50': () => {
        throw status(400, 'Dados inválidos');
      },
    });
    const user = userEvent.setup();
    render(<Contacts onOpenConversation={vi.fn()} />);
    await user.click(await screen.findByText('João Cliente'));
    expect(await screen.findByText('Sem conversas visíveis para você.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByText('Dados inválidos')).toBeInTheDocument());
  });
});
