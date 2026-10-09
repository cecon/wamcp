import { cn } from './cn';
import { initials } from '../api';
import type { Availability } from '../types';

/** Chatwoot components-next/avatar initials palette: [background, text]. */
const PALETTE: [string, string][] = [
  ['#FBDCEF', '#C2298A'],
  ['#FFE0BB', '#99543A'],
  ['#E8E8E8', '#60646C'],
  ['#CCF3EA', '#008573'],
  ['#EBEBFE', '#4747C2'],
  ['#E1E9FF', '#3A5BC7'],
];
const STATUS: Record<Availability, string> = {
  online: 'bg-n-teal-10',
  busy: 'bg-n-amber-10',
  offline: 'bg-n-slate-10',
};

function pick(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

interface Props {
  name: string | null | undefined;
  size?: number;
  status?: Availability;
  className?: string;
}

export function Avatar({ name, size = 32, status, className }: Props) {
  const label = name || '?';
  const [background, color] = pick(label);
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <span
        className="flex size-full items-center justify-center rounded-full font-medium select-none"
        style={{ background, color, fontSize: Math.max(10, Math.round(size * 0.4)) }}
        aria-hidden
      >
        {initials(label)}
      </span>
      {status && (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 rounded-full border border-n-slate-3',
            STATUS[status],
          )}
          style={{ width: Math.max(8, size / 4), height: Math.max(8, size / 4) }}
          aria-label={status}
        />
      )}
    </span>
  );
}
