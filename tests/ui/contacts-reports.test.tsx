import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactsPage } from '../../src/agent/ContactsPage';
import { Reports } from '../../src/agent/Reports';
import { duration, timeAgo } from '../../src/agent/api';
import { fakeApi, status } from './fake-api';
import { admin, contact, inbox, labels, maria, team } from './fixtures';

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

describe('reports', () => {
  const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
  it('shows metric cards, agent status, agents and CSAT for the period', async () => {
    const api = fakeApi({
      'GET /reports/summary': {
        conversations: 12,
        incoming_messages: 40,
        outgoing_messages: 35,
        first_response: { count: 10, average: 95 },
        resolutions: { count: 8, average: 7400 },
        csat: { count: 3, average: 4.333 },
      },
      'GET /reports/agents': [
        { id: 2, name: 'Maria Souza', resolved: 5, avg_first_response: 30, avg_resolution: 3600, csat: null },
      ],
      'GET /csat_responses': [
        {
          id: 1,
          display_id: 7,
          contact_name: 'João',
          assignee_name: 'Maria Souza',
          rating: 5,
          feedback: 'ótimo',
        },
        { id: 2, display_id: 8, contact_name: null, assignee_name: null, rating: 3, feedback: null },
        { id: 3, display_id: 9, contact_name: 'X', assignee_name: null, rating: 1, feedback: null },
      ],
    });
    const user = userEvent.setup();
    render(<Reports catalog={catalog} />);
    expect(await screen.findByText('40 / 35')).toBeInTheDocument();
    expect(screen.getByText('2min')).toBeInTheDocument();
    expect(screen.getByText('2h 3min')).toBeInTheDocument();
    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('AO VIVO')).toBeInTheDocument();
    expect(screen.getByText('“ótimo”')).toBeInTheDocument();
    expect(screen.getAllByText('Sem responsável')).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('Período'), '30');
    await user.selectOptions(screen.getByLabelText('Caixa de entrada'), '10');
    await waitFor(() =>
      expect(api.called('GET', '/reports/summary').at(-1)!.search).toContain('inbox_id=10'),
    );
    api.route('GET /reports/summary', () => {
      throw status(403, 'Somente administradores podem fazer isso');
    });
    await user.selectOptions(screen.getByLabelText('Período'), '1');
    expect(await screen.findByText('Somente administradores podem fazer isso')).toBeInTheDocument();
  });

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
