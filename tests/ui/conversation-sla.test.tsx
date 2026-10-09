import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactPanel } from '../../src/agent/conversations/ContactPanel';
import { ActionsEditor } from '../../src/agent/settings/ActionsEditor';
import { notificationText } from '../../src/agent/notifications/notificationText';
import type { Action } from '../../src/agent/types';
import { fakeApi, status } from './fake-api';
import { admin, contact, conversation, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const policies = [
  {
    id: 3,
    name: 'Ouro',
    description: null,
    first_response_time_threshold: 1800,
    next_response_time_threshold: null,
    resolution_time_threshold: 3600,
  },
  {
    id: 4,
    name: 'Prata',
    description: null,
    first_response_time_threshold: null,
    next_response_time_threshold: 600,
    resolution_time_threshold: null,
  },
];
const now = () => Math.floor(Date.now() / 1000);
const sla = (state: Record<string, unknown>, policy = policies[0]) => ({
  policy,
  applied: { sla_policy_id: policy.id, created_at: now(), status: 'active', missed_at: null },
  state: {
    status: 'active',
    first_response_due_at: null,
    next_response_due_at: null,
    resolution_due_at: null,
    missed: [],
    ...state,
  },
});

function renderPanel() {
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
  return userEvent.setup();
}

describe('conversation SLA', () => {
  it('applies a policy and shows its deadlines with countdown and missed badges', async () => {
    const api = fakeApi({
      'GET /contacts/50': contact,
      'GET /sla_policies': policies,
      'GET /conversations/7/sla': () => null,
      'POST /conversations/7/sla': () =>
        sla({ first_response_due_at: now() + 1830, resolution_due_at: now() - 60, missed: [] }),
    });
    const user = renderPanel();
    expect(api.called('GET', '/conversations/7/sla')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    expect(await screen.findByText('Nenhum SLA aplicado.')).toBeInTheDocument();
    const select = screen.getByLabelText('Política de SLA');
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    await within(select).findByRole('option', { name: 'Ouro' });
    await user.selectOptions(select, '3');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByText('Em andamento')).toBeInTheDocument();
    expect(api.called('POST', '/conversations/7/sla')[0].body).toEqual({ sla_policy_id: 3 });
    expect(screen.getByText(/^vence em 30min/)).toBeInTheDocument();
    // The resolution deadline already passed: it shows as missed before the server settles it.
    expect(screen.getByText('perdido')).toBeInTheDocument();
    expect(screen.queryByText('Próxima resposta')).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Trocar SLA…' })).toBeInTheDocument();
  });

  it('shows missed and met SLAs and reports errors', async () => {
    const api = fakeApi({
      'GET /contacts/50': contact,
      'GET /sla_policies': policies,
      'GET /conversations/7/sla': sla({ status: 'missed', missed: ['next_response'] }, policies[1]),
      'POST /conversations/7/sla': () => {
        throw status(404, 'SLA não encontrado');
      },
    });
    const user = renderPanel();
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    expect(await screen.findByText('Perdido')).toBeInTheDocument();
    expect(screen.getByText('Prata', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('perdido')).toBeInTheDocument();
    await within(screen.getByLabelText('Política de SLA')).findByRole('option', { name: 'Ouro' });
    await user.selectOptions(screen.getByLabelText('Política de SLA'), '3');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByText('SLA não encontrado')).toBeInTheDocument();

    api.route('GET /conversations/7/sla', sla({ status: 'hit' }));
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    expect(await screen.findByText('Cumprido')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    api.route('GET /conversations/7/sla', () => {
      throw status(500, 'Falha no SLA');
    });
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    expect(await screen.findByText('Falha no SLA')).toBeInTheDocument();
  });

  it('labels the missed SLA notification', () => {
    const n = {
      id: 1,
      notification_type: 'sla_missed',
      display_id: 7,
      contact_name: 'João',
      actor_name: null,
      read_at: null,
      created_at: 1,
    };
    expect(notificationText(n)).toBe('SLA perdido na conversa #7');
  });
});

function Editor({ initial, onChange }: { initial: Action[]; onChange: (a: Action[]) => void }) {
  const [actions, setActions] = useState(initial);
  return (
    <ActionsEditor
      actions={actions}
      catalog={catalog}
      onChange={(next) => {
        setActions(next);
        onChange(next);
      }}
    />
  );
}

describe('add_sla action', () => {
  it('loads the policies only when an SLA action exists and picks one', async () => {
    const api = fakeApi({ 'GET /sla_policies': policies });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Editor initial={[{ action_name: 'add_label', action_params: [] }]} onChange={onChange} />);
    expect(api.called('GET', '/sla_policies')).toHaveLength(0);
    await user.selectOptions(screen.getByLabelText('Ação 1'), 'add_sla');
    const param = screen.getByLabelText('Parâmetro 1');
    await within(param).findByRole('option', { name: 'Prata' });
    await user.selectOptions(param, '4');
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([{ action_name: 'add_sla', action_params: ['4'] }]),
    );
    expect(api.called('GET', '/sla_policies')).toHaveLength(1);
  });
});
