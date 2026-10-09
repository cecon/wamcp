import { useState } from 'react';
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
  /** Photo (e.g. the contact's WhatsApp picture); initials show while missing or if it fails. */
  src?: string | null;
}

export function Avatar({ name, size = 32, status, className, src }: Props) {
  const label = name || '?';
  const [background, color] = pick(label);
  const [broken, setBroken] = useState<string | null>(null);
  const photo = src && broken !== src ? src : null;
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {photo ? (
        <img
          src={photo}
          alt=""
          className="size-full rounded-full object-cover"
          onError={() => setBroken(photo)}
        />
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-full font-medium select-none"
          style={{ background, color, fontSize: Math.max(10, Math.round(size * 0.4)) }}
          aria-hidden
        >
          {initials(label)}
        </span>
      )}
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
