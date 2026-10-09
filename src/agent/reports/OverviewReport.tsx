import type { Catalog } from '../types';
import { MetricReport } from './MetricReport';
import { useReportPeriod } from './period';
import { ReportFilters } from './ReportFilters';
import { ReportCard, ReportLayout, Stat } from './ReportParts';

/** Chatwoot reports overview: live agent status, the account metrics and their chart. */
export function OverviewReport({ catalog }: { catalog: Catalog }) {
  const { period, range, setPeriod } = useReportPeriod();
  const count = (value: string) => catalog.agents.filter((a) => a.active && a.availability === value).length;
  return (
    <ReportLayout title="Visão geral" filters={<ReportFilters period={period} onChange={setPeriod} />}>
      <ReportCard title="Status dos agentes" live>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Stat label="Online" value={count('online')} />
          <Stat label="Ocupados" value={count('busy')} />
          <Stat label="Offline" value={count('offline')} />
        </div>
      </ReportCard>
      <MetricReport scope={{}} range={range} groupBy={period.groupBy} />
    </ReportLayout>
  );
}
