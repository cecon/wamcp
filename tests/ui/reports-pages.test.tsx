import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Reports } from '../../src/agent/Reports';
import { fakeApi, status } from './fake-api';
import { catalog, params, row, series, summary } from './report-fixtures';

describe('breakdown reports', () => {
  it('lists agents and shows the metrics of the selected one', async () => {
    const api = fakeApi({
      'GET /reports/breakdown/agent': [
        row(2, 'Maria Souza'),
        row(1, 'Admin', { avg_first_response_time: 0 }),
      ],
      'GET /reports/summary_v2': summary,
      'GET /reports': series,
    });
    const user = userEvent.setup();
    render(<Reports catalog={catalog} section="agents" />);
    expect(await screen.findByRole('button', { name: 'Maria Souza' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agentes' })).toBeInTheDocument();
    expect(screen.getByText('30s')).toBeInTheDocument();
    expect(screen.getAllByText('1h')).toHaveLength(2);
    expect(api.called('GET', '/reports/summary_v2')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Maria Souza' }));
    expect(await screen.findByRole('heading', { name: 'Agente: Maria Souza' })).toBeInTheDocument();
    await waitFor(() => {
      const q = params(api.called('GET', '/reports/summary_v2'));
      expect([q.get('type'), q.get('id')]).toEqual(['agent', '2']);
    });
    expect(params(api.called('GET', '/reports')).get('type')).toBe('agent');
    expect(await screen.findByText('2min 5s')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    expect(screen.queryByRole('heading', { name: 'Agente: Maria Souza' })).not.toBeInTheDocument();
  });

  it('filters label reports by title and shows empty inboxes and teams', async () => {
    const api = fakeApi({
      'GET /reports/breakdown/label': [row(null, 'vip')],
      'GET /reports/breakdown/inbox': [],
      'GET /reports/breakdown/team': () => {
        throw status(403, 'Somente administradores podem fazer isso');
      },
      'GET /reports/summary_v2': summary,
      'GET /reports': [],
    });
    const user = userEvent.setup();
    const view = render(<Reports catalog={catalog} section="labels" />);
    await user.click(await screen.findByRole('button', { name: 'vip' }));
    await waitFor(() => {
      const q = params(api.called('GET', '/reports/summary_v2'));
      expect([q.get('type'), q.get('label'), q.has('id')]).toEqual(['label', 'vip', false]);
    });
    view.rerender(<Reports catalog={catalog} section="inboxes" />);
    expect(await screen.findByText('Sem dados no período.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Caixas de entrada' })).toBeInTheDocument();
    view.rerender(<Reports catalog={catalog} section="teams" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Somente administradores podem fazer isso');
  });
});

describe('CSAT report', () => {
  const metrics = {
    total: 4,
    sent: 8,
    ratings: { '1': 1, '2': 0, '3': 0, '4': 1, '5': 2 },
    average: 3.8,
    satisfaction_score: 75,
    response_rate: 50,
  };
  const responses = [
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
  ];

  it('shows the metric cards, distribution and answers and downloads the CSV', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = fakeApi({
      'GET /csat_survey_responses/metrics': metrics,
      'GET /csat_responses': responses,
      'GET /csat_survey_responses/download': () => 'conversa,contato\n7,João\n',
    });
    const user = userEvent.setup();
    render(<Reports catalog={catalog} section="csat" />);
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('3,8')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    const distribution = screen.getByRole('list', { name: 'Distribuição das notas' });
    expect(within(distribution).getByText('2 (50%)')).toBeInTheDocument();
    expect(within(distribution).getAllByText('0 (0%)')).toHaveLength(2);
    expect(await screen.findByText('“ótimo”')).toBeInTheDocument();
    expect(screen.getAllByText('Sem responsável')).toHaveLength(2);
    expect(screen.getByText('#8 · Contato')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agrupar por')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(params(api.called('GET', '/csat_survey_responses/download')).has('since')).toBe(true);
    api.route('GET /csat_survey_responses/download', () => {
      throw status(403, 'Sem permissão');
    });
    await user.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');
  });

  it('shows empty values without answers', async () => {
    fakeApi({
      'GET /csat_survey_responses/metrics': {
        ...metrics,
        total: 0,
        sent: 0,
        ratings: {},
        average: null,
        satisfaction_score: null,
        response_rate: null,
      },
      'GET /csat_responses': [],
    });
    render(<Reports catalog={catalog} section="csat" />);
    expect(await screen.findByText('Nenhuma avaliação no período.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(3));
  });
});

describe('AI assistant and SLA reports', () => {
  it('shows bot metrics', async () => {
    const api = fakeApi({
      'GET /reports/bots': {
        conversations: 10,
        resolutions: 6,
        handoffs: 4,
        resolution_rate: 60,
        handoff_rate: 40,
      },
    });
    const user = userEvent.setup();
    render(<Reports catalog={catalog} section="bots" />);
    expect(await screen.findByText('60%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assistente IA' })).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Período'), '90');
    await waitFor(() => {
      const q = params(api.called('GET', '/reports/bots'));
      expect(Number(q.get('until')) - Number(q.get('since'))).toBe(90 * 86400);
    });
  });

  it('shows SLA metrics, with zeros when nothing was applied', async () => {
    const api = fakeApi({
      'GET /applied_slas/metrics': { total: 5, hit: 3, missed: 1, active: 1, hit_rate: 75 },
    });
    const view = render(<Reports catalog={catalog} section="sla" />);
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Perdidos')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    view.unmount();
    api.route('GET /applied_slas/metrics', {
      total: 0,
      hit: null,
      missed: null,
      active: null,
      hit_rate: null,
    });
    render(<Reports catalog={catalog} section="sla" />);
    await waitFor(() => expect(screen.getAllByText('0')).toHaveLength(4));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
