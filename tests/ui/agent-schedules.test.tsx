import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { RosterAgent } from '../../src/agent/adminTypes';
import type { Catalog } from '../../src/agent/types';
import type { AgentSchedule, ScheduleRun } from '../../src/agent/settings/schedules/types';
import { fakeApi, status } from './fake-api';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog: Catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };
const ai = (id: number, name: string, extra: Partial<RosterAgent> = {}): RosterAgent =>
  ({
    id,
    name,
    kind: 'ai',
    role: 'operator',
    profile_id: 1,
    profile_name: 'Operador',
    description: null,
    user_id: null,
    user_name: null,
    user_email: null,
    whatsapp_jid: null,
    runtime: 'claude_cli',
    model: 'sonnet',
    instructions: null,
    active: true,
    skill_ids: [],
    profile_skill_ids: [],
    credential_count: 0,
    created: '',
    ...extra,
  }) as RosterAgent;
const roster = [ai(7, 'Ana'), ai(8, 'Bia'), ai(1, 'Sistema', { system: true })];
const daily: AgentSchedule = {
  id: 1,
  name: 'Pendências',
  cron: '0 9 * * *',
  interval_minutes: null,
  timezone: 'America/Sao_Paulo',
  prompt: 'Liste as conversas sem resposta.',
  active: true,
  created_by: 1,
  last_run_at: null,
  next_run_at: Date.UTC(2026, 9, 30, 12, 0),
  created_at: 0,
  agent_ids: [7],
};
const run = (id: number, status: ScheduleRun['status'], extra: Partial<ScheduleRun> = {}): ScheduleRun => ({
  id,
  schedule_id: 1,
  agent_id: 7,
  agent_name: 'Ana',
  status,
  output: null,
  error: null,
  started_at: Date.UTC(2026, 9, 29, 12, 0),
  finished_at: Date.UTC(2026, 9, 29, 12, 0, 12),
  ...extra,
});

function store() {
  let schedules = [daily];
  return {
    'GET /agent_schedules': () => schedules,
    'GET /agent_directory': roster,
    'POST /agent_schedules/preview': (body: unknown) => {
      const { cron } = body as { cron: string | null };
      if (cron === '0 25 * * *') throw status(400, 'Campo de hora inválido na expressão cron: 25');
      return [Date.UTC(2026, 9, 30, 11, 0), Date.UTC(2026, 9, 31, 11, 0)];
    },
    'POST /agent_schedules': (body: unknown) => {
      schedules = [...schedules, { ...daily, ...(body as object), id: 2 }];
      return schedules.at(-1)!;
    },
    'POST /agent_schedules/1/runs': [run(3, 'running', { finished_at: null })],
    'GET /agent_schedules/1/runs': [
      run(2, 'done', { output: 'Relatório: 3 conversas sem resposta.' }),
      run(1, 'skipped', { error: 'A execução anterior deste agente ainda não terminou' }),
    ],
  };
}

const renderPage = () => {
  render(
    <SettingsRouter
      route={{ page: 'settings', section: 'schedules' }}
      user={admin}
      catalog={catalog}
      onNavigate={vi.fn()}
      onChange={vi.fn(async () => {})}
    />,
  );
  return userEvent.setup();
};

describe('agent schedules settings', () => {
  it('lists schedules and creates one from a preset with subscribed agents (never the system agent)', async () => {
    const api = fakeApi(store());
    const user = renderPage();
    expect(await screen.findByText('Pendências')).toBeInTheDocument();
    expect(screen.getByText('Todo dia às 9h')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Novo agendamento' }));
    const panel = screen.getByRole('dialog', { name: 'Novo agendamento' });
    expect(within(panel).queryByLabelText('Sistema')).not.toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Nome'), 'Bom dia');
    await user.selectOptions(within(panel).getByLabelText('Quando'), 'Dias úteis às 8h');
    await user.type(within(panel).getByLabelText('Tarefa'), 'Resuma o dia anterior.');
    await user.click(within(panel).getByLabelText('Ana'));
    await user.click(within(panel).getByLabelText('Bia'));
    expect(await within(panel).findByText(/Próximas execuções/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Salvar agendamento' }));

    await waitFor(() => expect(api.called('POST', '/agent_schedules')).toHaveLength(1));
    expect(api.called('POST', '/agent_schedules')[0].body).toEqual({
      name: 'Bom dia',
      cron: '0 8 * * 1-5',
      interval_minutes: null,
      timezone: 'America/Sao_Paulo',
      prompt: 'Resuma o dia anterior.',
      active: true,
      agent_ids: [7, 8],
    });
    expect(await screen.findByText('Bom dia')).toBeInTheDocument();
  });

  it('edits a custom cron with live feedback on the next runs', async () => {
    fakeApi(store());
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Editar Pendências' }));
    const panel = screen.getByRole('dialog', { name: 'Editar agendamento' });
    await user.selectOptions(within(panel).getByLabelText('Quando'), 'Personalizado…');
    const cron = within(panel).getByLabelText('Expressão cron');
    await user.clear(cron);
    await user.type(cron, '0 25 * * *');
    expect(await within(panel).findByText(/hora inválido/)).toBeInTheDocument();
    await user.click(within(panel).getByLabelText('Por intervalo'));
    expect(within(panel).getByLabelText('A cada quantos minutos')).toHaveValue(30);
  });

  it('runs a schedule now and shows the run history', async () => {
    const api = fakeApi(store());
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Executar agora Pendências' }));
    await waitFor(() => expect(api.called('POST', '/agent_schedules/1/runs')).toHaveLength(1));
    expect(await screen.findByText(/começou agora/)).toBeInTheDocument();
    const panel = await screen.findByRole('dialog', { name: 'Execuções de Pendências' });
    expect(await within(panel).findByText('Relatório: 3 conversas sem resposta.')).toBeInTheDocument();
    expect(within(panel).getByText('Concluída')).toBeInTheDocument();
    expect(within(panel).getByText('Pulada')).toBeInTheDocument();
    expect(within(panel).getByText(/ainda não terminou/)).toBeInTheDocument();
  });
});
