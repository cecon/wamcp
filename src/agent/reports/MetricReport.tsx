import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

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

/** Métrica com a variação contra o período anterior; clicar mostra no gráfico (lote 14). */
function MetricTile({ metric, value, selected, onSelect }: TileProps) {
  const change = value ? trend(value.current, value.previous) : null;
  // Response and resolution times improve when they go down.
  const good = change !== null && (metric.time ? change <= 0 : change >= 0);
  return (
    <Button
      variant="outlined"
      aria-pressed={selected}
      onClick={onSelect}
      sx={{
        flexDirection: 'column',
        alignItems: 'flex-start',
        textTransform: 'none',
        p: 1.5,
        borderColor: selected ? 'primary.main' : 'divider',
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
        {metric.label}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 0.5 }}>
        <Typography variant="h5">{value ? formatMetric(metric.key, value.current) : '…'}</Typography>
        {change !== null && (
          <span
            title="Em relação ao período anterior"
            className={cn('text-xs font-medium', good ? 'text-n-teal-11' : 'text-n-ruby-11')}
          >
            {change > 0 ? '+' : ''}
            {change}%
          </span>
        )}
      </Stack>
    </Button>
  );
}

interface Props {
  scope: ReportScope;
  range: Range;
  groupBy: GroupBy;
}

/** ReportContainer no C3Theme (lote 14): resumo das seis métricas e o gráfico da selecionada. */
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
        <Box role="alert" sx={{ color: 'error.main', fontSize: 14 }}>
          {error}
        </Box>
      )}
      <ReportCard>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 1,
          }}
        >
          {METRICS.map((m) => (
            <MetricTile
              key={m.key}
              metric={m}
              value={summary.data?.[m.key]}
              selected={m.key === metric}
              onSelect={() => setMetric(m.key)}
            />
          ))}
        </Box>
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
