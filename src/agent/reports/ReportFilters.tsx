// material-ui
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';

import { GROUP_LABEL, PRESET_LABEL, type GroupBy, type Preset, type ReportPeriod } from './period';

interface Props {
  period: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
  /** Pages without a chart (CSAT, bots, SLA) hide the group-by selector. */
  grouping?: boolean;
}

/** Filtros de período no C3Theme (lote 14): presets (com intervalo personalizado) e agrupamento do gráfico. */
export function ReportFilters({ period, onChange, grouping = true }: Props) {
  const set = (patch: Partial<ReportPeriod>) => onChange({ ...period, ...patch });
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      <TextField
        select
        size="small"
        label="Período"
        value={period.preset}
        onChange={(event) => set({ preset: event.target.value as Preset })}
        slotProps={{ select: { native: true } }}
        sx={{ minWidth: 150 }}
      >
        {Object.entries(PRESET_LABEL).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </TextField>
      {period.preset === 'custom' && (
        <>
          <TextField
            type="date"
            size="small"
            label="Data inicial"
            value={period.from}
            onChange={(event) => set({ from: event.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: period.to } }}
          />
          <TextField
            type="date"
            size="small"
            label="Data final"
            value={period.to}
            onChange={(event) => set({ to: event.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: period.from } }}
          />
        </>
      )}
      {grouping && (
        <TextField
          select
          size="small"
          label="Agrupar por"
          value={period.groupBy}
          onChange={(event) => set({ groupBy: event.target.value as GroupBy })}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 150 }}
        >
          {Object.entries(GROUP_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </TextField>
      )}
    </Box>
  );
}
