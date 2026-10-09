import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactsPage } from '../../src/agent/ContactsPage';
import { duration, timeAgo } from '../../src/agent/api';
import { fakeApi, status } from './fake-api';
import { contact } from './fixtures';

describe('contacts', () => {
  it('searches, edits a contact in the side panel and opens a conversation', async () => {
    const api = fakeApi({
      'GET /contacts': (_b: unknown, url: URL) =>
        url.searchParams.get('q') === 'zzz'
          ? []
          : [
              contact,
              { ...contact, id: 51, name: null, email: null, phone_number: null, last_activity_at: null },
            ],
      'GET /contacts/50': contact,
      'PATCH /contacts/50': (body) => ({ ...contact, ...(body as object) }),
    });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ContactsPage onOpenConversation={onOpen} />);
    expect(await screen.findByText('João Cliente')).toBeInTheDocument();
    expect(screen.getByText('Sem nome')).toBeInTheDocument();
    expect(screen.getByText('2 contatos')).toBeInTheDocument();
    await user.click(screen.getByText('João Cliente'));
    const panel = await screen.findByRole('dialog', { name: 'João Cliente' });
    const name = within(panel).getByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'João Silva');
    await user.click(within(panel).getByRole('button', { name: 'Salvar contato' }));
    expect(await within(panel).findByText('Contato salvo.')).toBeInTheDocument();
    expect(api.called('PATCH', '/contacts/50')[0].body).toEqual({
      name: 'João Silva',
      email: 'joao@example.com',
    });
    await user.click(within(panel).getByRole('button', { name: /#3/ }));
    expect(onOpen).toHaveBeenCalledWith(3);
    await user.click(within(panel).getByRole('button', { name: 'Fechar' }));
    await user.type(screen.getByLabelText('Pesquisar contatos…'), 'zzz');
    expect(await screen.findByText('Nenhum contato encontrado.')).toBeInTheDocument();
    expect(screen.getByText('0 contatos')).toBeInTheDocument();
  });

  it('reports save errors and contacts without conversations', async () => {
    fakeApi({
      'GET /contacts': [contact],
      'GET /contacts/50': { ...contact, conversations: [] },
      'PATCH /contacts/50': () => {
        throw status(400, 'Dados inválidos');
      },
    });
    const user = userEvent.setup();
    render(<ContactsPage onOpenConversation={vi.fn()} />);
    expect(await screen.findByText('1 contato')).toBeInTheDocument();
    await user.click(screen.getByText('João Cliente'));
    expect(await screen.findByText('Sem conversas visíveis para você.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar contato' }));
    expect(await screen.findByText('Dados inválidos')).toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('formats durations and relative times', () => {
    expect([duration(null), duration(45), duration(600), duration(3600), duration(5400)]).toEqual([
      '—',
      '45s',
      '10min',
      '1h',
      '1h 30min',
    ]);
    const now = 1_000_000;
    expect([
      timeAgo(now - 10, now),
      timeAgo(now - 300, now),
      timeAgo(now - 7200, now),
      timeAgo(now - 3 * 86400, now),
    ]).toEqual(['agora', '5m', '2h', '3d']);
    expect(timeAgo(now - 30 * 86400, now)).toMatch(/^\d{2}\/\d{2}$/);
  });
});
