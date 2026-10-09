import { GROUP_LABEL, PRESET_LABEL, type GroupBy, type Preset, type ReportPeriod } from './period';

const select = 'field !h-8 !w-auto !py-1';

interface Props {
  period: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
  /** Pages without a chart (CSAT, bots, SLA) hide the group-by selector. */
  grouping?: boolean;
}

/** Chatwoot ReportFilters: date range presets (with a custom range) and the chart grouping. */
export function ReportFilters({ period, onChange, grouping = true }: Props) {
  const set = (patch: Partial<ReportPeriod>) => onChange({ ...period, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Período"
        className={select}
        value={period.preset}
        onChange={(e) => set({ preset: e.target.value as Preset })}
      >
        {Object.entries(PRESET_LABEL).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      {period.preset === 'custom' && (
        <>
          <input
            type="date"
            aria-label="Data inicial"
            className={select}
            value={period.from}
            max={period.to}
            onChange={(e) => set({ from: e.target.value })}
          />
          <input
            type="date"
            aria-label="Data final"
            className={select}
            value={period.to}
            min={period.from}
            onChange={(e) => set({ to: e.target.value })}
          />
        </>
      )}
      {grouping && (
        <select
          aria-label="Agrupar por"
          className={select}
          value={period.groupBy}
          onChange={(e) => set({ groupBy: e.target.value as GroupBy })}
        >
          {Object.entries(GROUP_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
