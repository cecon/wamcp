import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import { ContactsPage } from '../../src/agent/ContactsPage';
import { connectRealtime } from '../../src/agent/api';
import type { AuditLog } from '../../src/agent/accountTypes';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { admin, contact, inbox, labels, maria, team, workspaceRoutes } from './fixtures';

const log = (id: number, fields: Partial<AuditLog> = {}): AuditLog => ({
  id,
  user_id: 1,
  user_name: 'Admin',
  action: 'update',
  auditable_type: 'inbox',
  auditable_id: 10,
  details: { method: 'PATCH', path: '/inboxes/10' },
  ip_address: '203.0.113.9',
  created_at: 1_760_000_000,
  ...fields,
});
const nav = () => screen.getByRole('navigation');

describe('audit log', () => {
  it('lists entries in pt-BR with pagination from the settings sidebar', async () => {
    const first = [
      log(1, { action: 'clone', auditable_type: 'automation_rule', auditable_id: 4 }),
      log(2, {
        user_name: null,
        action: 'remove_mfa',
        auditable_type: 'user',
        ip_address: null,
        details: null,
      }),
      ...Array.from({ length: 48 }, (_, i) => log(i + 3)),
    ];
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /audit_logs': (_body, url) =>
        url.searchParams.get('page') === '1'
          ? first
          : [log(99, { action: 'custom_thing', auditable_type: 'sla_x' })],
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await user.click(within(nav()).getByRole('button', { name: 'Configurações' }));
    await user.click(within(nav()).getByRole('button', { name: 'Registro de auditoria' }));
    expect(await screen.findByRole('heading', { name: 'Registro de auditoria' })).toBeInTheDocument();
    const clone = (await screen.findByText('Clonou')).closest('tr')!;
    expect(within(clone).getByText('Automação')).toBeInTheDocument();
    expect(within(clone).getByText('203.0.113.9')).toBeInTheDocument();
    expect(
      within(clone).getByText(
        new Date(1_760_000_000_000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
      ),
    ).toBeInTheDocument();
    const reset = screen.getByText('Redefiniu a verificação em duas etapas').closest('tr')!;
    expect(within(reset).getByText('Sistema')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('custom thing')).toBeInTheDocument();
    expect(screen.getByText('sla x')).toBeInTheDocument();
    expect(screen.getByText('Página 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Clonou')).toBeInTheDocument();
    expect(api.called('GET', '/audit_logs').map((c) => c.search)).toEqual(['?page=1', '?page=2', '?page=1']);
  });

  it('reports errors', async () => {
    fakeApi({
      'GET /audit_logs': () => {
        throw status(403, 'Apenas administradores');
      },
    });
    render(
      <SettingsRouter
        route={{ page: 'settings', section: 'audit' }}
        user={admin}
        catalog={{ inboxes: [], agents: [], teams: [], labels: [] }}
        onNavigate={vi.fn()}
        onChange={vi.fn(async () => {})}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Apenas administradores');
  });
});

describe('agent two-factor reset', () => {
  it('lets administrators reset an agent two-factor authentication', async () => {
    const api = fakeApi({ 'DELETE /agents/2/mfa': { ok: true } });
    const onChange = vi.fn(async () => {});
    const catalog = {
      inboxes: [inbox],
      agents: [admin, { ...maria, mfa_enabled: 1 }],
      teams: [team],
      labels,
    };
    render(
      <SettingsRouter
        route={{ page: 'settings', section: 'agents' }}
        user={admin}
        catalog={catalog}
        onNavigate={vi.fn()}
        onChange={onChange}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByText(/Ativo.*Verificação em duas etapas$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar Maria Souza' }));
    await user.click(screen.getByRole('button', { name: 'Redefinir verificação em duas etapas' }));
    await waitFor(() => expect(api.called('DELETE', '/agents/2/mfa')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });
});

describe('contacts realtime', () => {
  it('merges contact updates and removes deleted contacts, closing their detail', async () => {
    const other = { ...contact, id: 51, name: 'Outro', phone_number: '+5511900000000', conversations: [] };
    fakeApi({ 'GET /contacts': [contact, other], 'GET /contacts/50': contact, 'GET /contacts/50/notes': [] });
    const user = userEvent.setup();
    render(<ContactsPage onOpenConversation={vi.fn()} user={admin} realtime={connectRealtime(() => {})} />);
    await user.click(await screen.findByText('João Cliente'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    FakeEventSource.emit('contact.updated', { ...other, name: 'Outro Renomeado' });
    expect(await screen.findByText('Outro Renomeado')).toBeInTheDocument();
    FakeEventSource.emit('contact.deleted', { id: 50 });
    await waitFor(() => expect(screen.queryByText('João Cliente')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1 contato')).toBeInTheDocument();
  });
});
