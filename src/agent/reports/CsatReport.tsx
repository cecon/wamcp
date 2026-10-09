import { useState } from 'react';
import { Download } from 'lucide-react';
import { download, query } from '../api';
import type { CsatMetrics } from '../parityTypes';
import { useFetch } from '../useFetch';
import { Button } from '../ui/Button';
import { CsatResponses, RatingDistribution, type CsatRow } from './CsatResponses';
import { formatNumber, formatPercent } from './metrics';
import { reportQuery, useReportPeriod } from './period';
import { ReportFilters } from './ReportFilters';
import { ReportCard, ReportLayout, Stat } from './ReportParts';

/** Chatwoot CSAT report: metric cards, rating distribution, the latest answers and the CSV export. */
export function CsatReport() {
  const { period, range, setPeriod } = useReportPeriod();
  const [downloadError, setDownloadError] = useState('');
  const q = reportQuery({}, range);
  const metrics = useFetch<CsatMetrics>(`/csat_survey_responses/metrics${q}`);
  const responses = useFetch<CsatRow[]>(
    `/csat_responses${query({ since: range.since, until: range.until })}`,
  );
  const m = metrics.data;
  const exportCsv = () => {
    setDownloadError('');
    download(`/csat_survey_responses/download${q}`, 'csat.csv').catch((e: Error) =>
      setDownloadError(e.message),
    );
  };
  return (
    <ReportLayout
      title="CSAT"
      error={metrics.error || responses.error || downloadError}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <ReportFilters period={period} onChange={setPeriod} grouping={false} />
          <Button color="slate" icon={Download} label="Baixar CSV" onClick={exportCsv} />
        </div>
      }
    >
      <div className="flex flex-col gap-4 md:flex-row">
        <ReportCard title="Satisfação" className="md:w-[60%]">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Stat label="Respostas" value={formatNumber(m?.total)} />
            <Stat label="Pesquisas enviadas" value={formatNumber(m?.sent)} />
            <Stat label="Taxa de resposta" value={formatPercent(m?.response_rate)} />
            <Stat
              label="Índice de satisfação"
              value={formatPercent(m?.satisfaction_score)}
              hint="Notas 4 e 5"
            />
            <Stat label="Nota média" value={formatNumber(m?.average)} />
          </div>
        </ReportCard>
        <ReportCard title="Distribuição das notas" className="md:w-[40%]">
          <RatingDistribution ratings={m?.ratings || {}} total={m?.total || 0} />
        </ReportCard>
      </div>
      <ReportCard title="Avaliações recentes">
        <CsatResponses rows={responses.data || []} />
      </ReportCard>
    </ReportLayout>
  );
}
