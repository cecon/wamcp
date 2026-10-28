import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { RosterAgent } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { ActivityDetail, EngineActivity } from '../../src/agent/settings/engine/types';
import { fakeApi } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const ai = (id: number, name: string, role: 'coordinator' | 'operator'): RosterAgent =>
  ({
    id,
    name,
    kind: 'ai',
    role,
    profile_id: 1,
    profile_name: role,
    description: null,
    user_id: null,
    user_name: null,
    user_email: null,
    whatsapp_jid: null,
    runtime: 'opencode',
    model: 'openrouter/openai/gpt-5',
    instructions: null,
    active: true,
    skill_ids: [],
    profile_skill_ids: [],
    credential_count: 0,
    created: '',
  }) as RosterAgent;
const activity = (
  id: number,
  agent: number,
  status: EngineActivity['status'],
  parent: number | null = null,
): EngineActivity => ({
  id,
  requester: 'user:1',
  agent_id: agent,
  parent_id: parent,
  status,
  request: 'O cliente ACME pagou?',
  result: status === 'completed' ? 'ACME: pago (R$ 1250)' : null,
  evidence: status === 'completed' ? ['ev_1'] : [],
  error: null,
  conversation_id: null,
  correlation_id: 'c1',
  attempts: 1,
  created: '2026-10-28T12:00:00Z',
  updated: '2026-10-28T12:00:05Z',
});
const detail: ActivityDetail = {
  activity: activity(1, 10, 'waiting_approval'),
  delegations: [
    { id: 1, activity_id: 2, from_agent_id: 10, to_agent_id: 11, skill: 'consultar_pagamento', hops: 1 },
  ],
  tree: [
    { activity: activity(1, 10, 'waiting_approval'), runs: [], tool_calls: [], evidence: [], messages: [] },
    {
      activity: activity(2, 11, 'waiting_approval', 1),
      runs: [
        {
          id: 5,
          runtime: 'opencode',
          model: null,
          status: 'completed',
          attempt: 1,
          input_tokens: 1000,
          output_tokens: 200,
          cached_tokens: 0,
          cost_usd: 0.006,
          cost_source: 'reported',
          error: null,
          started: '',
        },
      ],
      tool_calls: [
        {
          id: 9,
          agent_id: 11,
          tool: 'financeiro.consultar_pagamento',
          args: { cliente: 'ACME' },
          status: 'pending_approval',
          result: null,
          evidence_id: null,
        },
      ],
      evidence: [],
      messages: [{ id: 1, from_agent_id: 10, to_agent_id: 11, body: 'O cliente ACME pagou?', created: '' }],
    },
  ],
  audit: [
    {
      id: 1,
      activity_id: 1,
      agent_id: 10,
      action: 'delegation.request',
      outcome: 'delegated',
      at: '2026-10-28T12:00:01Z',
    },
  ],
};

function renderEngine() {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'engine' }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
}

describe('agentic engine page', () => {
  it('lists requests, shows the delegation tree and approves a pending tool call', async () => {
    const api = fakeApi({
      'GET /engine/activities': [activity(1, 10, 'waiting_approval'), activity(2, 11, 'waiting_approval', 1)],
      'GET /agent_directory': [ai(10, 'Lu', 'coordinator'), ai(11, 'Anny', 'operator')],
      'GET /engine/activities/1': detail,
      'POST /engine/tool_calls/9/decision': { id: 9, status: 'ok' },
    });
    const user = renderEngine();
    // Delegated child activities are not listed as requests of their own.
    expect(await screen.findByText('1 pedido')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'O cliente ACME pagou?' }));
    const panel = await screen.findByRole('dialog', { name: 'Pedido #1' });
    const anny = await within(panel).findByRole('region', { name: 'Atividade de Anny' });
    expect(
      within(anny).getByText(/delegado por Lu \(skill consultar_pagamento, salto 1\)/),
    ).toBeInTheDocument();
    expect(within(anny).getByText(/1.200 tokens · US\$ 0.0060/)).toBeInTheDocument();
    await user.click(within(anny).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.called('POST', '/engine/tool_calls/9/decision')).toHaveLength(1));
    expect(api.called('POST', '/engine/tool_calls/9/decision')[0].body).toEqual({ approve: true });
  });

  it('sends a new request to an AI agent and grants tools per agent', async () => {
    const api = fakeApi({
      'GET /engine/activities': [],
      'GET /agent_directory': [ai(10, 'Lu', 'coordinator'), ai(11, 'Anny', 'operator')],
      'POST /engine/activities': activity(3, 10, 'queued'),
      'GET /engine/activities/3': {
        ...detail,
        activity: activity(3, 10, 'queued'),
        tree: [],
        delegations: [],
        audit: [],
      },
      'GET /engine/catalog': {
        tools: [
          {
            name: 'financeiro.consultar_pagamento',
            description: 'Consulta pagamentos',
            builtin: false,
            side_effects: false,
            sensitive: false,
          },
        ],
        runtimes: [{ id: 'opencode', available: true, detail: null }],
      },
      'GET /engine/agents/11/policy': {
        policy: {
          agent_id: 11,
          enabled: true,
          proactive_enabled: false,
          execution_policy: 'approval_for_sensitive',
          max_concurrency: 2,
          run_timeout_secs: 180,
          monthly_token_budget: null,
        },
        grants: [],
      },
      'GET /engine/agents/10/policy': {
        policy: {
          agent_id: 10,
          enabled: true,
          proactive_enabled: false,
          execution_policy: 'approval_for_sensitive',
          max_concurrency: 2,
          run_timeout_secs: 180,
          monthly_token_budget: null,
        },
        grants: [],
      },
      'PUT /engine/agents/11/grants': (body) => body,
    });
    const user = renderEngine();
    await user.click(await screen.findByRole('button', { name: 'Novo pedido' }));
    const ask = screen.getByRole('dialog', { name: 'Novo pedido' });
    await user.type(within(ask).getByLabelText('Pedido'), 'Lu, o cliente ACME pagou?');
    await user.click(within(ask).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.called('POST', '/engine/activities')).toHaveLength(1));
    expect(api.called('POST', '/engine/activities')[0].body).toEqual({
      agent_id: 10,
      request: 'Lu, o cliente ACME pagou?',
    });
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    await user.click(screen.getByRole('button', { name: 'Permissões' }));
    const panel = await screen.findByRole('dialog', { name: 'Permissões dos agentes de IA' });
    // Coordinators only delegate: their tool grants are locked.
    expect(await within(panel).findByText(/Coordenadores não executam ferramentas/)).toBeInTheDocument();
    await user.selectOptions(within(panel).getByLabelText('Agente'), '11');
    const select = await within(panel).findByLabelText('Permissão para financeiro.consultar_pagamento');
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, 'allow');
    await waitFor(() => expect(api.called('PUT', '/engine/agents/11/grants')).toHaveLength(1));
    expect(api.called('PUT', '/engine/agents/11/grants')[0].body).toEqual({
      tool: 'financeiro.consultar_pagamento',
      effect: 'allow',
    });
  });
});
