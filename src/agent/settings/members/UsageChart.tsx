import type { UsageDay } from '../../adminTypes';
import { count, fillDays } from './format';

/** Stacked bars of input and output tokens per day. */
export function UsageChart({ usage, days = 30 }: { usage: UsageDay[]; days?: number }) {
  const series = fillDays(usage, days);
  const max = Math.max(1, ...series.map((d) => d.input_tokens + d.output_tokens));
  const width = 300,
    height = 96,
    gap = 2;
  const bar = width / series.length;
  const total = series.reduce((sum, d) => sum + d.input_tokens + d.output_tokens, 0);
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full"
        role="img"
        aria-label={`Tokens nos últimos ${days} dias: ${count(total)}`}
        preserveAspectRatio="none"
      >
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--color-n-slate-6)" />
        {series.map((d, i) => {
          const input = (d.input_tokens / max) * (height - 4);
          const output = (d.output_tokens / max) * (height - 4);
          const x = i * bar + gap / 2;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${count(d.input_tokens)} de entrada, ${count(d.output_tokens)} de saída`}</title>
              <rect x={x} width={bar - gap} y={height - input} height={input} fill="var(--color-n-blue-9)" />
              <rect
                x={x}
                width={bar - gap}
                y={height - input - output}
                height={output}
                fill="var(--color-n-amber-9)"
              />
            </g>
          );
        })}
      </svg>
      <figcaption className="flex gap-4 text-xs text-n-slate-11">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-n-blue-9" aria-hidden /> Entrada
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-n-amber-9" aria-hidden /> Saída
        </span>
      </figcaption>
    </figure>
  );
}
