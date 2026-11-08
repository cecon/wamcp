import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

// third-party
import { Download } from 'lucide-react';

import { download, query } from '../api';
import type { CsatMetrics } from '../parityTypes';
import { useFetch } from '../useFetch';
import { CsatResponses, RatingDistribution, type CsatRow } from './CsatResponses';
import { formatNumber, formatPercent } from './metrics';
import { reportQuery, useReportPeriod } from './period';
import { ReportFilters } from './ReportFilters';
import { ReportCard, ReportLayout, Stat } from './ReportParts';

/** CSAT no C3Theme (lote 13): cards de métrica, distribuição das notas, respostas recentes e exportação CSV. */
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
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <ReportFilters period={period} onChange={setPeriod} grouping={false} />
          <Button variant="outlined" startIcon={<Download size={16} />} onClick={exportCsv}>
            Baixar CSV
          </Button>
        </Stack>
      }
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <ReportCard title="Satisfação" className="md:w-[60%]">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
              gap: 3,
            }}
          >
            <Stat label="Respostas" value={formatNumber(m?.total)} />
            <Stat label="Pesquisas enviadas" value={formatNumber(m?.sent)} />
            <Stat label="Taxa de resposta" value={formatPercent(m?.response_rate)} />
            <Stat
              label="Índice de satisfação"
              value={formatPercent(m?.satisfaction_score)}
              hint="Notas 4 e 5"
            />
            <Stat label="Nota média" value={formatNumber(m?.average)} />
          </Box>
        </ReportCard>
        <ReportCard title="Distribuição das notas" className="md:w-[40%]">
          <RatingDistribution ratings={m?.ratings || {}} total={m?.total || 0} />
        </ReportCard>
      </Stack>
      <ReportCard title="Avaliações recentes">
        <CsatResponses rows={responses.data || []} />
      </ReportCard>
    </ReportLayout>
  );
}
