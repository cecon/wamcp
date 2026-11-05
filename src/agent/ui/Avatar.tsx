import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import MuiAvatar from '@mui/material/Avatar';

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
  online: 'var(--color-n-teal-10)',
  busy: 'var(--color-n-amber-10)',
  offline: 'var(--color-n-slate-10)',
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

/** Avatar do app sobre o `Avatar` do MUI, com iniciais determinísticas e o ponto de disponibilidade. */
export function Avatar({ name, size = 32, status, className, src }: Props) {
  const label = name || '?';
  const [background, color] = pick(label);
  const [broken, setBroken] = useState<string | null>(null);
  const photo = src && broken !== src ? src : null;
  return (
    <Box
      className={className}
      sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0, width: size, height: size }}
    >
      <MuiAvatar
        src={photo ?? undefined}
        alt=""
        onError={() => photo && setBroken(photo)}
        sx={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          bgcolor: photo ? 'transparent' : background,
          color,
          fontSize: Math.max(10, Math.round(size * 0.4)),
          fontWeight: 500,
          userSelect: 'none',
        }}
      >
        {initials(label)}
      </MuiAvatar>
      {status && (
        <Box
          aria-label={status}
          sx={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: Math.max(8, size / 4),
            height: Math.max(8, size / 4),
            borderRadius: '50%',
            border: 1,
            borderColor: 'var(--color-n-slate-3)',
            bgcolor: STATUS[status],
          }}
        />
      )}
    </Box>
  );
}
