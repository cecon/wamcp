import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentPage } from '../../src/agent/agentPage/AgentPage';
import { attention, summarize, type SummaryInput } from '../../src/agent/agentPage/summary';
import type { AgentHistory } from '../../src/agent/agentPage/types';
import type { RosterAgent } from '../../src/agent/adminTypes';
import type { EngineActivity } from '../../src/agent/settings/engine/types';
import type { Catalog } from '../../src/agent/types';
import { fakeApi } from './fake-api';
import { admin, inbox, labels, team } from './fixtures';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');

const LU: RosterAgent = {
  id: 3,
  name: 'Lu',
  kind: 'ai',
  role: 'operator',
  profile_id: 21,
  profile_name: 'Operador',
  description: null,
  user_id: null,
  user_name: null,
  user_email: null,
  whatsapp_jid: null,
  runtime: 'opencode',
  model: 'openrouter/openai/gpt-5',
  instructions: 'Atenda o delivery.',
  active: true,
  skill_ids: [],
  credential_count: 0,
  supervisor_id: null,
  avatar: {},
};

const activity = (id: number, over: Partial<EngineActivity> = {}): EngineActivity => ({
  id,
  requester: 'user:1',
  agent_id: 3,
  parent_id: null,
  status: 'completed',
  request: `Pedido ${id}`,
  result: null,
  evidence: [],
  error: null,
  conversation_id: null,
  correlation_id: `c${id}`,
  attempts: 1,
  created: '2026-11-07T10:00:00.000Z',
  updated: '2026-11-07T10:05:00.000Z',
  ...over,
});

const conversation = (id: number, handedTo: string | null, reason: string | null = null) => ({
  id,
  display_id: id,
  inbox_id: 1,
  inbox_name: 'Padaria',
  contact_name: `Cliente ${id}`,
  status: handedTo ? 'open' : 'resolved',
  turns: 2,
  first_at: '2026-11-07T09:00:00.000Z',
  last_at: '2026-11-07T09:10:00.000Z',
  handoff_at: handedTo ? NOW / 1000 - 3600 : null,
  handed_to: handedTo,
  handoff_reason: reason,
});

const HISTORY: AgentHistory = {
  days: 30,
  conversations: [
    conversation(11, null),
    conversation(12, 'Ana', 'a IA não conseguiu resolver'),
    conversation(13, null),
  ],
  schedule_runs: [
    {
      id: 1,
      schedule_id: 4,
      schedule_name: 'Fechamento do caixa',
      status: 'failed',
      output: null,
      error: 'Sem acesso ao banco',
      started_at: NOW - 7_200_000,
      finished_at: NOW - 7_100_000,
    },
  ],
};

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  history: HISTORY,
  activities: [
    activity(1),
    activity(2, { status: 'failed', error: 'Tempo esgotado' }),
    activity(3, { status: 'waiting_approval' }),
  ],
  runs: [],
  paused: false,
  monthBrl: 1.2,
  now: NOW,
  ...over,
});

describe('resumo da página do agente', () => {
  it('conta o que importa em frases', () => {
    const text = summarize(input()).join(' ');
    expect(text).toContain('Agora está livre.');
    expect(text).toContain('Nos últimos 30 dias, atendeu 3 conversas e passou 1 para pessoas.');
    expect(text).toContain('Recebeu 3 pedidos no motor: 1 concluído, 1 falhou e 1 em aberto.');
    expect(text).toContain('Rodou 1 rotina, 1 falhou.');
    expect(text).toMatch(/Neste mês, custou R\$\s1,20 até agora\./);
    expect(summarize(input({ paused: true }))[0]).toMatch(/^Está pausado/);
  });

  it('põe pausa e aprovações antes de erros e passagens para pessoas', () => {
    const items = attention(input({ paused: true }));
    expect(items.map((i) => i.kind)).toEqual(['paused', 'approval', 'error', 'error', 'handoff']);
    const handoff = items[items.length - 1];
    expect(handoff.title).toBe('Passou a conversa #12 com Cliente 12 para Ana');
    expect(handoff.detail).toBe('Motivo: a IA não conseguiu resolver');
    // Pedidos fora do período não contam como erro.
    const old = activity(9, { status: 'failed', created: '2026-01-01T00:00:00.000Z' });
    expect(attention(input({ activities: [old] })).filter((i) => i.kind === 'error')).toHaveLength(1);
  });
});

const catalog: Catalog = { inboxes: [{ ...inbox, ai_agent_id: 3 }], agents: [admin], teams: [team], labels };

describe('página do agente', () => {
  it('mostra o resumo e o que espera por você, e pausa o agente', async () => {
    const api = fakeApi({
      'GET /agent_directory': [LU],
      'GET /skills': [],
      'GET /agent_directory/3/history': HISTORY,
      'GET /engine/activities': [
        activity(1),
        activity(3, { status: 'waiting_approval', request: 'Enviar cupom' }),
      ],
      'GET /agent_directory/salaries': {
        month: '2026-11',
        rates: { seat_price_brl: 50, ai_margin_percent: 50, usd_brl_rate: 5.5 },
        salaries: [],
      },
      'GET /agents/live': [{ id: 3, name: 'Lu', active: true, paused: false }],
      'PUT /agents/live/3/paused': {},
      'GET /custom_roles': [],
    });
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<AgentPage agentId={3} catalog={catalog} runs={[]} onNavigate={onNavigate} />);

    expect(await screen.findByRole('heading', { name: 'Lu', level: 1 })).toBeInTheDocument();
    const summary = await screen.findByRole('region', { name: 'Resumo' });
    expect(
      await within(summary).findByText(/atendeu 3 conversas e passou 1 para pessoas/),
    ).toBeInTheDocument();
    const waiting = screen.getByRole('region', { name: 'Espera por você' });
    expect(await within(waiting).findByText('Pedido #3 espera a sua aprovação')).toBeInTheDocument();
    expect(within(waiting).getByText('A rotina “Fechamento do caixa” falhou')).toBeInTheDocument();
    expect(within(waiting).getByText('Motivo: a IA não conseguiu resolver')).toBeInTheDocument();

    await user.click(within(waiting).getByRole('button', { name: 'Abrir conversa' }));
    expect(onNavigate).toHaveBeenCalledWith({ page: 'conversations', displayId: 12 });

    // O histórico fica recolhido até ser aberto.
    expect(screen.queryByRole('tab', { name: /Conversas · 3/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Histórico/ }));
    expect(await screen.findByRole('tab', { name: /Conversas · 3/ })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() =>
      expect(api.called('PUT', '/agents/live/3/paused')[0]?.body).toEqual({ paused: true }),
    );
  });
});
