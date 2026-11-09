import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AgentApp from '../../src/agent/AgentApp';
import '../../src/agent/shell/C3Workspace';
import { FakeEventSource, fakeApi } from './fake-api';
import { workspaceRoutes } from './fixtures';
import { navFind } from './nav';

const run = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'conversation',
  state: 'running',
  agent_id: 4,
  agent_name: 'Ana',
  title: `Conversa #${id.split(':')[1]} · Maria`,
  inbox_id: 1,
  inbox_name: 'Padaria',
  display_id: Number(id.split(':')[1]),
  owner_id: null,
  detail: 'Usando consultar_estoque',
  again: false,
  queued_at: Date.now() - 5000,
  started_at: Date.now() - 4000,
  updated_at: Date.now(),
  ...over,
});

afterEach(() => window.history.replaceState({}, '', '/'));

describe('Agentes ao vivo', () => {
  it('agrupa as sessões por agente e segue os eventos do stream', async () => {
    FakeEventSource.instances = [];
    fakeApi({
      ...workspaceRoutes(),
      'GET /agent_runs': [
        run('conversation:7'),
        run('conversation:8', { state: 'queued', detail: null, started_at: null }),
      ],
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' }, { timeout: 8000 });
    await user.click(await navFind(/Agentes ao vivo/));

    expect(
      await screen.findByRole('heading', { name: 'Agentes ao vivo' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    const group = (await screen.findByRole('heading', { name: 'Ana' })).closest('div')!.parentElement!;
    expect(within(group).getByText('2 sessões em paralelo')).toBeInTheDocument();
    expect(within(group).getByText('Usando consultar_estoque')).toBeInTheDocument();
    expect(within(group).getByText('Aguardando vaga do runtime')).toBeInTheDocument();
    // O menu mostra quantas sessões estão em andamento.
    expect(within(screen.getByRole('navigation')).getByText('2')).toBeInTheDocument();

    FakeEventSource.emit('agent_run.finished', run('conversation:8'));
    FakeEventSource.emit('agent_run.updated', run('conversation:9', { agent_id: 5, agent_name: 'Jhon' }));
    expect(await screen.findByRole('heading', { name: 'Jhon' })).toBeInTheDocument();
    expect(screen.queryByText('Aguardando vaga do runtime')).not.toBeInTheDocument();
    expect(screen.getAllByText('1 sessão')).toHaveLength(2);
  });

  it('pausa o agente, encerra uma conversa e cancela um pedido do motor', async () => {
    const api = fakeApi({
      ...workspaceRoutes(),
      'GET /agent_runs': [
        run('conversation:7'),
        run('engine:9', { kind: 'engine', title: 'Pedido #9', display_id: null, inbox_id: null }),
      ],
      'GET /agents/live': [
        { id: 4, name: 'Ana', active: true, paused: false },
        { id: 6, name: 'Rota', active: true, paused: true },
      ],
      'PUT /agents/live/4/paused': {},
      'PUT /agents/live/6/paused': {},
      'POST /agents/live/conversations/7/stop': {},
      'POST /engine/activities/9/cancel': { id: 9, status: 'cancelled' },
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' }, { timeout: 8000 });
    await user.click(await navFind(/Agentes ao vivo/));

    await user.click(await screen.findByRole('button', { name: 'Pausar Ana' }, { timeout: 8000 }));
    await waitFor(() =>
      expect(api.called('PUT', '/agents/live/4/paused')[0]?.body).toEqual({ paused: true }),
    );
    // Um agente pausado sem sessão aparece à parte, para ser retomado.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retomar Rota' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Retomar Rota' }));
    await waitFor(() =>
      expect(api.called('PUT', '/agents/live/6/paused')[0]?.body).toEqual({ paused: false }),
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Encerrar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Encerrar' }));
    expect(await screen.findByText(/a conversa passa para uma pessoa da caixa/)).toBeInTheDocument();
    const stop = screen.getByRole('dialog', { name: /Encerrar/ });
    await user.click(within(stop).getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(api.called('POST', '/agents/live/conversations/7/stop')).toHaveLength(1));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    const cancel = await screen.findByRole('dialog', { name: /Cancelar/ });
    await user.click(within(cancel).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(api.called('POST', '/engine/activities/9/cancel')).toHaveLength(1));
  });
});
