import { useState } from 'react';
import { query } from '../api';

export type Preset = '7' | '30' | '90' | 'month' | 'custom';
export type GroupBy = 'day' | 'week' | 'month';
export interface ReportPeriod {
  preset: Preset;
  /** Custom range (YYYY-MM-DD, local time). */
  from: string;
  to: string;
  groupBy: GroupBy;
}
export interface Range {
  since: number;
  until: number;
}
/** What a report is about: the account (default) or one inbox, agent, team or label. */
export interface ReportScope {
  type?: 'inbox' | 'agent' | 'team' | 'label';
  id?: number;
  label?: string;
}

export const PRESET_LABEL: Record<Preset, string> = {
  '7': 'Últimos 7 dias',
  '30': 'Últimos 30 dias',
  '90': 'Últimos 90 dias',
  month: 'Este mês',
  custom: 'Personalizado',
};
export const GROUP_LABEL: Record<GroupBy, string> = { day: 'Dia', week: 'Semana', month: 'Mês' };

const DAY = 86400;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Epoch range of a period at `now`; an incomplete or inverted custom range falls back to 7 days. */
export function periodRange(period: ReportPeriod, now = new Date()): Range {
  const until = seconds(now) + 1;
  if (period.preset === 'month')
    return { since: seconds(new Date(now.getFullYear(), now.getMonth(), 1)), until };
  if (period.preset === 'custom') {
    const from = new Date(`${period.from}T00:00:00`),
      to = new Date(`${period.to}T00:00:00`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to)
      return { since: seconds(from), until: seconds(to) + DAY };
    return { since: until - 7 * DAY, until };
  }
  return { since: until - Number(period.preset) * DAY, until };
}

/** Query string for a report endpoint: scope, period and any extra parameter. */
export const reportQuery = (scope: ReportScope, range: Range, extra: Record<string, string> = {}) =>
  query({
    type: scope.type,
    id: scope.id,
    label: scope.label,
    since: range.since,
    until: range.until,
    ...extra,
  });

/** Period state of a report page; the range is computed when the period changes, not on each render. */
export function useReportPeriod() {
  const [state, setState] = useState(() => {
    const today = isoDate(new Date());
    const period: ReportPeriod = { preset: '7', from: today, to: today, groupBy: 'day' };
    return { period, range: periodRange(period) };
  });
  const setPeriod = (period: ReportPeriod) => setState({ period, range: periodRange(period) });
  return { ...state, setPeriod };
}
