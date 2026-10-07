import type { ReportPoint } from '../parityTypes';
import type { GroupBy } from './period';

const W = 640,
  H = 220,
  TOP = 16,
  BOTTOM = 24,
  PLOT = H - TOP - BOTTOM;

/** Bucket start (UTC, like the API) → "07/10" or "out. de 26". */
function bucketLabel(ts: number, groupBy: GroupBy) {
  const date = new Date(ts * 1000);
  return groupBy === 'month'
    ? date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

interface Props {
  label: string;
  points: ReportPoint[];
  groupBy: GroupBy;
  format: (value: number) => string;
}

/** Chatwoot BarChart drawn with plain SVG: one bar per bucket, a few axis labels and the peak value. */
export function BarChart({ label, points, groupBy, format }: Props) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const slot = W / Math.max(points.length, 1);
  const width = Math.max(2, Math.min(32, slot * 0.6));
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <figure className="w-full">
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={TOP + PLOT * (1 - f)}
            y2={TOP + PLOT * (1 - f)}
            className="stroke-n-weak"
            strokeWidth={1}
          />
        ))}
        {max > 0 && (
          <text x={4} y={TOP - 4} fontSize={11} className="fill-n-slate-11">
            {format(max)}
          </text>
        )}
        {points.map((p, i) => {
          const height = max ? (p.value / max) * PLOT : 0;
          const x = i * slot + (slot - width) / 2;
          const name = bucketLabel(p.timestamp, groupBy);
          return (
            <g key={p.timestamp}>
              <rect
                x={x}
                y={TOP + PLOT - height}
                width={width}
                height={height}
                rx={2}
                className="fill-n-brand"
              >
                <title>{`${name}: ${format(p.value)}`}</title>
              </rect>
              {i % every === 0 && (
                <text
                  x={x + width / 2}
                  y={H - 6}
                  fontSize={11}
                  textAnchor="middle"
                  className="fill-n-slate-11"
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
