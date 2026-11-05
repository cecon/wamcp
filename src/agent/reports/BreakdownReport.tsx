import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { X } from 'lucide-react';

import type { BreakdownRow } from '../parityTypes';
import { useFetch } from '../useFetch';
import { Cell, Table } from '../ui/Settings';
import { cn } from '../ui/cn';
import { formatMetric } from './metrics';
import { MetricReport } from './MetricReport';
import { reportQuery, useReportPeriod, type ReportScope } from './period';
import { ReportFilters } from './ReportFilters';
import { ReportCard, ReportLayout } from './ReportParts';

export type BreakdownKind = 'agent' | 'inbox' | 'team' | 'label';
const TITLE: Record<BreakdownKind, [string, string]> = {
  agent: ['Agentes', 'Agente'],
  inbox: ['Caixas de entrada', 'Caixa de entrada'],
  team: ['Times', 'Time'],
  label: ['Etiquetas', 'Etiqueta'],
};

const scopeOf = (kind: BreakdownKind, row: BreakdownRow): ReportScope =>
  kind === 'label' ? { type: 'label', label: row.name } : { type: kind, id: row.id ?? undefined };

/** Relatórios por agente/caixa/time/etiqueta no C3Theme (lote 13): uma linha por item; selecionar mostra métricas. */
export function BreakdownReport({ kind }: { kind: BreakdownKind }) {
  const { period, range, setPeriod } = useReportPeriod();
  const [selected, setSelected] = useState<BreakdownRow | null>(null);
  const { data, error } = useFetch<BreakdownRow[]>(`/reports/breakdown/${kind}${reportQuery({}, range)}`);
  const rows = data || [];
  const [title, singular] = TITLE[kind];
  return (
    <ReportLayout
      title={title}
      error={error}
      filters={<ReportFilters period={period} onChange={setPeriod} />}
    >
      <ReportCard>
        <Table
          headers={[singular, 'Conversas', 'Resoluções', '1ª resposta (média)', 'Resolução (média)']}
          rows={rows.length}
          empty="Sem dados no período."
        >
          {rows.map((row) => (
            <tr key={`${row.id}-${row.name}`} className={cn(selected?.name === row.name && 'bg-n-alpha-1')}>
              <Cell>
                <button
                  type="button"
                  aria-pressed={selected?.name === row.name}
                  onClick={() => setSelected(row)}
                  className="font-medium text-n-slate-12 hover:text-n-blue-11 hover:underline"
                >
                  {row.name}
                </button>
              </Cell>
              <Cell>{formatMetric('conversations_count', row.conversations_count)}</Cell>
              <Cell>{formatMetric('resolutions_count', row.resolutions_count)}</Cell>
              <Cell>{formatMetric('avg_first_response_time', row.avg_first_response_time)}</Cell>
              <Cell>{formatMetric('avg_resolution_time', row.avg_resolution_time)}</Cell>
            </tr>
          ))}
        </Table>
      </ReportCard>
      {selected && (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" component="h2">
              {singular}: {selected.name}
            </Typography>
            <Button variant="outlined" startIcon={<X size={16} />} onClick={() => setSelected(null)}>
              Limpar seleção
            </Button>
          </Stack>
          <MetricReport
            key={selected.name}
            scope={scopeOf(kind, selected)}
            range={range}
            groupBy={period.groupBy}
          />
        </>
      )}
    </ReportLayout>
  );
}
