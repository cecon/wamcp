import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import AgentApp from '../../src/agent/AgentApp';
import '../../src/agent/shell/C3Workspace';
import { FakeEventSource, fakeApi } from './fake-api';
import { workspaceRoutes } from './fixtures';

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
    window.history.replaceState({}, '', '/agents-live');
    FakeEventSource.instances = [];
    fakeApi({
      ...workspaceRoutes(),
      'GET /agent_runs': [
        run('conversation:7'),
        run('conversation:8', { state: 'queued', detail: null, started_at: null }),
      ],
    });
    render(<AgentApp />);

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
});
