import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { ContactsPage } from '../../src/agent/ContactsPage';
import { ConversationCard } from '../../src/agent/conversations/ConversationCard';
import { Reports } from '../../src/agent/Reports';
import { canOpen } from '../../src/agent/permissions';
import type { Conversation, User } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, contact, conversation, labels, maria, workspaceRoutes } from './fixtures';
import { catalog, summary } from './report-fixtures';

const nav = () => screen.getByRole('navigation');
const withRole = (permissions: string[]): User => ({ ...maria, custom_role_id: 4, permissions });

describe('navigation by permission', () => {
  it('shows reports and hides contacts for a role with report_manage only', async () => {
    fakeApi({
      ...workspaceRoutes(withRole(['report_manage'])),
      'GET /reports/summary_v2': summary,
      'GET /reports': [],
      'GET /search': { conversations: [], contacts: [contact], messages: [] },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: 'Contatos' })).not.toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: 'Configurações' })).not.toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Relatórios' }));
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeInTheDocument();

    // A contact reached from the global search shows the no-access page.
    await user.click(screen.getByRole('button', { name: 'Pesquisa global' }));
    await user.type(screen.getByLabelText('Pesquisar mensagens, contatos ou conversas'), 'joão');
    const contacts = await screen.findByRole('region', { name: 'Contatos' });
    await user.click(within(contacts).getByRole('button'));
    expect(await screen.findByText('Você não tem acesso a esta página')).toBeInTheDocument();
  });

  it('shows contacts and hides reports for a role with contact_manage', async () => {
    fakeApi({ ...workspaceRoutes(withRole(['contact_manage'])), 'GET /contacts': [] });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    expect(within(nav()).queryByRole('button', { name: 'Relatórios' })).not.toBeInTheDocument();
    await user.click(within(nav()).getByRole('button', { name: 'Contatos' }));
    expect(await screen.findByRole('heading', { name: 'Contatos' })).toBeInTheDocument();
  });

  it('keeps contacts for agents without a role and everything for administrators', () => {
    const contacts = { page: 'contacts' } as const,
      reports = { page: 'reports' } as const;
    expect([canOpen(maria, contacts), canOpen(maria, reports)]).toEqual([true, false]);
    expect([canOpen(withRole([]), contacts), canOpen(withRole([]), reports)]).toEqual([false, false]);
    const adminWithRole = { ...admin, custom_role_id: 4, permissions: [] };
    expect([canOpen(adminWithRole, contacts), canOpen(adminWithRole, reports)]).toEqual([true, true]);
    expect(canOpen(maria, { page: 'settings', section: 'macros' })).toBe(true);
    expect(canOpen(maria, { page: 'settings', section: 'custom_roles' })).toBe(false);
    expect(canOpen(maria, { page: 'search' })).toBe(true);
  });

  it('shows the no-access page when the contacts API answers 403', async () => {
    fakeApi({
      'GET /contacts': () => {
        throw status(403, 'Sem permissão');
      },
    });
    render(<ContactsPage onOpenConversation={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem acesso a esta página');
  });

  it('keeps other contact errors inline', async () => {
    fakeApi({
      'GET /contacts': () => {
        throw status(500, 'Erro interno');
      },
    });
    render(<ContactsPage onOpenConversation={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro interno');
  });
});

describe('SLA on conversation cards', () => {
  const card = (fields: Partial<Conversation>) =>
    render(
      <ul>
        <ConversationCard
          conversation={{ ...conversation, labels: [], ...fields }}
          labels={labels}
          selected={false}
          onSelect={vi.fn()}
        />
      </ul>,
    );

  it('shows a red badge when missed and a neutral one while active', () => {
    const missed = card({ sla_status: 'missed' });
    expect(screen.getByTitle('SLA perdido')).toHaveTextContent('SLA');
    expect(screen.getByTitle('SLA perdido').className).toContain('text-n-ruby-11');
    missed.unmount();
    const active = card({ sla_status: 'active', labels: ['vip'] });
    expect(screen.getByTitle('SLA em andamento')).toHaveTextContent('SLA');
    expect(screen.getByText('vip')).toBeInTheDocument();
    active.unmount();
    card({ sla_status: 'hit' });
    expect(screen.queryByText('SLA')).not.toBeInTheDocument();
  });

  it('shows no badge without an SLA', () => {
    card({ sla_status: null });
    expect(screen.queryByText('SLA')).not.toBeInTheDocument();
  });
});

describe('SLA metrics', () => {
  it('shows zero counts sent as 0', async () => {
    fakeApi({
      'GET /applied_slas/metrics': { total: 0, hit: 0, missed: 0, active: 0, hit_rate: null },
    });
    render(<Reports catalog={catalog} section="sla" />);
    await waitFor(() => expect(screen.getAllByText('0')).toHaveLength(4));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
