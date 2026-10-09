import { useState } from 'react';
import type { MetricKey, ReportPoint, ReportSummary } from '../parityTypes';
import { useFetch } from '../useFetch';
import { cn } from '../ui/cn';
import { BarChart } from './BarChart';
import { formatMetric, METRICS, trend } from './metrics';
import { reportQuery, type GroupBy, type Range, type ReportScope } from './period';
import { ReportCard } from './ReportParts';

interface TileProps {
  metric: (typeof METRICS)[number];
  value?: { current: number; previous: number };
  selected: boolean;
  onSelect: () => void;
}

/** Metric value with its change against the previous period; clicking shows it in the chart. */
function MetricTile({ metric, value, selected, onSelect }: TileProps) {
  const change = value ? trend(value.current, value.previous) : null;
  // Response and resolution times improve when they go down.
  const good = change !== null && (metric.time ? change <= 0 : change >= 0);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'rounded-lg p-3 text-left outline outline-1 -outline-offset-1 hover:bg-n-alpha-1',
        selected ? 'outline-n-brand' : 'outline-transparent',
      )}
    >
      <span className="block text-sm font-medium text-n-slate-11">{metric.label}</span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl text-n-slate-12">
          {value ? formatMetric(metric.key, value.current) : '…'}
        </span>
        {change !== null && (
          <span
            title="Em relação ao período anterior"
            className={cn('text-xs font-medium', good ? 'text-n-teal-11' : 'text-n-ruby-11')}
          >
            {change > 0 ? '+' : ''}
            {change}%
          </span>
        )}
      </span>
    </button>
  );
}

interface Props {
  scope: ReportScope;
  range: Range;
  groupBy: GroupBy;
}

/** Chatwoot ReportContainer: summary of the six metrics and the chart of the selected one. */
export function MetricReport({ scope, range, groupBy }: Props) {
  const [metric, setMetric] = useState<MetricKey>('conversations_count');
  const summary = useFetch<ReportSummary>(`/reports/summary_v2${reportQuery(scope, range)}`);
  const series = useFetch<ReportPoint[]>(
    `/reports${reportQuery(scope, range, { metric, group_by: groupBy })}`,
  );
  const selected = METRICS.find((m) => m.key === metric) || METRICS[0];
  const error = summary.error || series.error;
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <ReportCard>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((m) => (
            <MetricTile
              key={m.key}
              metric={m}
              value={summary.data?.[m.key]}
              selected={m.key === metric}
              onSelect={() => setMetric(m.key)}
            />
          ))}
        </div>
      </ReportCard>
      <ReportCard title={selected.label}>
        <BarChart
          label={`Gráfico: ${selected.label}`}
          points={series.data || []}
          groupBy={groupBy}
          format={(v) => formatMetric(selected.key, v)}
        />
      </ReportCard>
    </>
  );
}
