import type { ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { BotMetrics, SlaMetrics } from '../parityTypes';
import { useFetch } from '../useFetch';
import { formatNumber, formatPercent } from './metrics';
import { reportQuery, useReportPeriod, type Range } from './period';
import { ReportFilters } from './ReportFilters';
import { ReportCard, ReportLayout, Stat } from './ReportParts';

interface Props<T> {
  title: string;
  description: string;
  path: (range: Range) => string;
  stats: (data: T | null) => { label: string; value: ReactNode }[];
}

/** Relatório só de cards de métrica no C3Theme (lote 13): BotMetrics / métricas de SLA. */
function CardsReport<T>({ title, description, path, stats }: Props<T>) {
  const { period, range, setPeriod } = useReportPeriod();
  const { data, error } = useFetch<T>(path(range));
  return (
    <ReportLayout
      title={title}
      error={error}
      filters={<ReportFilters period={period} onChange={setPeriod} grouping={false} />}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
        {description}
      </Typography>
      <ReportCard>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' },
            gap: 3,
          }}
        >
          {stats(data).map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
        </Box>
      </ReportCard>
    </ReportLayout>
  );
}

export function BotsReport() {
  return (
    <CardsReport<BotMetrics>
      title="Assistente IA"
      description="Conversas atendidas pela IA (MCP): quantas ela resolveu sozinha e quantas transferiu para a equipe."
      path={(range) => `/reports/bots${reportQuery({}, range)}`}
      stats={(m) => [
        { label: 'Conversas', value: formatNumber(m?.conversations) },
        { label: 'Resolvidas pela IA', value: formatNumber(m?.resolutions) },
        { label: 'Transferidas', value: formatNumber(m?.handoffs) },
        { label: 'Taxa de resolução', value: formatPercent(m?.resolution_rate) },
        { label: 'Taxa de transferência', value: formatPercent(m?.handoff_rate) },
      ]}
    />
  );
}

export function SlaReport() {
  return (
    <CardsReport<SlaMetrics>
      title="SLA"
      description="SLAs aplicados no período: cumpridos, perdidos e ainda em andamento."
      path={(range) => `/applied_slas/metrics${reportQuery({}, range)}`}
      stats={(m) => [
        { label: 'SLAs aplicados', value: formatNumber(m?.total) },
        { label: 'Cumpridos', value: formatNumber(m?.hit ?? (m ? 0 : null)) },
        { label: 'Perdidos', value: formatNumber(m?.missed ?? (m ? 0 : null)) },
        { label: 'Em andamento', value: formatNumber(m?.active ?? (m ? 0 : null)) },
        { label: 'Taxa de cumprimento', value: formatPercent(m?.hit_rate) },
      ]}
    />
  );
}
