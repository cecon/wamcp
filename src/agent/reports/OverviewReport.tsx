// material-ui
import Stack from '@mui/material/Stack';

import type { Catalog } from '../types';
import { MetricReport } from './MetricReport';
import { useReportPeriod } from './period';
import { ReportFilters } from './ReportFilters';
import { ReportCard, ReportLayout, Stat } from './ReportParts';

/** Visão geral dos relatórios no C3Theme (lote 13): status ao vivo, métricas da conta e o gráfico. */
export function OverviewReport({ catalog }: { catalog: Catalog }) {
  const { period, range, setPeriod } = useReportPeriod();
  const count = (value: string) => catalog.agents.filter((a) => a.active && a.availability === value).length;
  return (
    <ReportLayout title="Visão geral" filters={<ReportFilters period={period} onChange={setPeriod} />}>
      <ReportCard title="Status dos agentes" live>
        <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 5, rowGap: 2 }}>
          <Stat label="Online" value={count('online')} />
          <Stat label="Ocupados" value={count('busy')} />
          <Stat label="Offline" value={count('offline')} />
        </Stack>
      </ReportCard>
      <MetricReport scope={{}} range={range} groupBy={period.groupBy} />
    </ReportLayout>
  );
}
