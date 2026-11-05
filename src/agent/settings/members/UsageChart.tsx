// material-ui
import Box from '@mui/material/Box';

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
    <Box component="figure" sx={{ display: 'flex', flexDirection: 'column', gap: 1, m: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height: 96, width: '100%' }}
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
      <Box
        component="figcaption"
        sx={{ display: 'flex', gap: 2, color: 'var(--color-n-slate-11)', fontSize: 12 }}
      >
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="span"
            aria-hidden
            sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: 'var(--color-n-blue-9)' }}
          />
          Entrada
        </Box>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="span"
            aria-hidden
            sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: 'var(--color-n-amber-9)' }}
          />
          Saída
        </Box>
      </Box>
    </Box>
  );
}
