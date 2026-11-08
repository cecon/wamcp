import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { Catalog } from '../../src/agent/types';
import type { LiveAgent } from '../../src/agent/settings/live/types';
import { fakeApi } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const agents = (paused: boolean): LiveAgent[] => [
  {
    id: 7,
    name: 'Ana',
    active: true,
    paused,
    answers: [
      { kind: 'conversation', id: 3, display_id: 12, agent_id: 7, running: true, since: Date.now() - 5000 },
      { kind: 'chat', id: 4, display_id: null, agent_id: 7, running: false, since: null },
    ],
    activities: [{ id: 9, status: 'running', request: 'O cliente ACME pagou?', created: '' }],
  },
  { id: 8, name: 'Rota', active: false, paused: false, answers: [], activities: [] },
];

function renderLive() {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'live' }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
}

describe('Agentes ao vivo', () => {
  it('shows what each agent is doing and pauses, stops and cancels', async () => {
    let paused = false;
    const api = fakeApi({
      'GET /agents/live': () => agents(paused),
      'PUT /agents/live/7/paused': (body) => {
        paused = (body as { paused: boolean }).paused;
        return {};
      },
      'POST /agents/live/conversations/3/stop': {},
      'POST /agents/live/chats/4/stop': {},
      'POST /engine/activities/9/cancel': { id: 9, status: 'cancelled' },
    });
    const user = renderLive();
    const ana = await screen.findByRole('region', { name: 'Agente Ana' });
    expect(within(ana).getByText(/Conversa #12 · respondendo há \d+s/)).toBeInTheDocument();
    expect(within(ana).getByText('Chat #4 · na fila')).toBeInTheDocument();
    expect(within(ana).getByText(/Pedido #9 · executando/)).toBeInTheDocument();
    const rota = screen.getByRole('region', { name: 'Agente Rota' });
    expect(within(rota).getByText('Desativado')).toBeInTheDocument();
    expect(within(rota).getByText('Sem nada em andamento.')).toBeInTheDocument();

    await user.click(within(ana).getByRole('button', { name: 'Pausar Ana' }));
    await waitFor(() =>
      expect(api.called('PUT', '/agents/live/7/paused')[0]?.body).toEqual({ paused: true }),
    );
    expect(await within(ana).findByRole('button', { name: 'Retomar Ana' })).toBeInTheDocument();
    expect(within(ana).getByText('Pausado')).toBeInTheDocument();

    await user.click(within(ana).getByRole('button', { name: 'Encerrar Conversa #12' }));
    expect(await screen.findByText(/a conversa passa para as pessoas da caixa/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(api.called('POST', '/agents/live/conversations/3/stop')).toHaveLength(1));

    await user.click(within(ana).getByRole('button', { name: 'Encerrar Chat #4' }));
    expect(await screen.findByText('O agente para agora e não responde esta mensagem.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(api.called('POST', '/agents/live/chats/4/stop')).toHaveLength(1));

    await user.click(within(ana).getByRole('button', { name: 'Cancelar pedido #9' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar pedido' }));
    await waitFor(() => expect(api.called('POST', '/engine/activities/9/cancel')).toHaveLength(1));
  });

  it('says when there are no AI agents', async () => {
    fakeApi({ 'GET /agents/live': [] });
    renderLive();
    expect(await screen.findByText('Nenhum agente de IA cadastrado.')).toBeInTheDocument();
  });
});
