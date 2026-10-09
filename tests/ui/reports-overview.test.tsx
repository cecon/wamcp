import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Reports } from '../../src/agent/Reports';
import { formatSeconds, formatPercent, trend } from '../../src/agent/reports/metrics';
import { periodRange, reportQuery } from '../../src/agent/reports/period';
import { fakeApi, status } from './fake-api';
import { catalog, params, series, summary } from './report-fixtures';

const localEpoch = (y: number, m: number, d: number) => Math.floor(new Date(y, m - 1, d).getTime() / 1000);

describe('reports overview', () => {
  it('shows the metric cards with their change, live agent status and the chart', async () => {
    const api = fakeApi({ 'GET /reports/summary_v2': summary, 'GET /reports': series });
    const user = userEvent.setup();
    render(<Reports catalog={catalog} />);
    expect(await screen.findByText('2min 5s')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Visão geral' })).toBeInTheDocument();
    expect(screen.getByText('2h 3min')).toBeInTheDocument();
    expect(screen.getByText('+20%')).toHaveClass('text-n-teal-11');
    expect(screen.getByText('-30%')).toHaveClass('text-n-ruby-11');
    // Slower first responses are bad news even though the number went up.
    expect(screen.getByText('+25%')).toHaveClass('text-n-ruby-11');
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('AO VIVO')).toBeInTheDocument();
    const live = screen.getByRole('region', { name: 'Status dos agentes' });
    expect(within(live).getAllByText('1')).toHaveLength(2);

    const chart = await screen.findByRole('img', { name: 'Gráfico: Conversas' });
    await waitFor(() => expect(chart.querySelectorAll('rect')).toHaveLength(2));
    expect(within(chart).getByText('05/10: 3')).toBeInTheDocument();
    expect(params(api.called('GET', '/reports')).get('metric')).toBe('conversations_count');
    expect(params(api.called('GET', '/reports')).get('group_by')).toBe('day');

    await user.click(screen.getByRole('button', { name: /Tempo de resolução/ }));
    expect(screen.getByRole('button', { name: /Tempo de resolução/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('img', { name: 'Gráfico: Tempo de resolução' })).toBeInTheDocument();
    await waitFor(() =>
      expect(params(api.called('GET', '/reports')).get('metric')).toBe('avg_resolution_time'),
    );

    await user.selectOptions(screen.getByLabelText('Agrupar por'), 'week');
    await waitFor(() => expect(params(api.called('GET', '/reports')).get('group_by')).toBe('week'));
    await user.selectOptions(screen.getByLabelText('Período'), '30');
    await waitFor(() => {
      const q = params(api.called('GET', '/reports/summary_v2'));
      expect(Number(q.get('until')) - Number(q.get('since'))).toBe(30 * 86400);
    });
  });

  it('accepts a custom range and reports errors', async () => {
    const api = fakeApi({ 'GET /reports/summary_v2': summary, 'GET /reports': [] });
    const user = userEvent.setup();
    render(<Reports catalog={catalog} section="overview" />);
    await screen.findByText('2min 5s');
    await user.selectOptions(screen.getByLabelText('Período'), 'custom');
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-01-31' } });
    await waitFor(() => {
      const q = params(api.called('GET', '/reports/summary_v2'));
      expect([Number(q.get('since')), Number(q.get('until'))]).toEqual([
        localEpoch(2026, 1, 1),
        localEpoch(2026, 2, 1),
      ]);
    });
    api.route('GET /reports/summary_v2', () => {
      throw status(403, 'Somente administradores podem fazer isso');
    });
    await user.selectOptions(screen.getByLabelText('Período'), 'month');
    expect(await screen.findByRole('alert')).toHaveTextContent('Somente administradores podem fazer isso');
  });
});

describe('report helpers', () => {
  it('formats times and percentages and computes the change', () => {
    expect([null, 0, 45, 60, 125, 3600, 3725, 90000].map(formatSeconds)).toEqual([
      '—',
      '—',
      '45s',
      '1min',
      '2min 5s',
      '1h',
      '1h 2min',
      '1d 1h',
    ]);
    expect(formatSeconds(0.2)).toBe('0s');
    expect([formatPercent(null), formatPercent(66.7)]).toEqual(['—', '66,7%']);
    expect([trend(5, 0), trend(15, 10), trend(5, 10)]).toEqual([null, 50, -50]);
  });

  it('turns periods into epoch ranges and query strings', () => {
    const now = new Date(2026, 9, 7, 15, 30);
    const until = Math.floor(now.getTime() / 1000) + 1;
    const base = { from: '', to: '', groupBy: 'day' as const };
    expect(periodRange({ ...base, preset: '7' }, now)).toEqual({ since: until - 7 * 86400, until });
    expect(periodRange({ ...base, preset: '90' }, now).since).toBe(until - 90 * 86400);
    expect(periodRange({ ...base, preset: 'month' }, now)).toEqual({ since: localEpoch(2026, 10, 1), until });
    // An inverted custom range falls back to the last 7 days.
    expect(periodRange({ ...base, preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, now).since).toBe(
      until - 7 * 86400,
    );
    expect(reportQuery({ type: 'label', label: 'vip' }, { since: 1, until: 2 }, { metric: 'x' })).toBe(
      '?type=label&label=vip&since=1&until=2&metric=x',
    );
  });
});
