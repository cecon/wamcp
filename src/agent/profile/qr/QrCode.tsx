import { useMemo } from 'react';

// material-ui
import Box from '@mui/material/Box';

import { encodeQr } from './encode';

const QUIET = 4;

/** SVG QR Code (black on white, 4-module quiet zone) rendered entirely in the browser. */
export function QrCode({ value, size = 192, label }: { value: string; size?: number; label: string }) {
  const { path, extent } = useMemo(() => {
    const modules = encodeQr(value);
    let d = '';
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }),
    );
    return { path: d, extent: modules.length + QUIET * 2 };
  }, [value]);
  return (
    <Box sx={{ display: 'block', lineHeight: 0, borderRadius: 1 }}>
      <svg
        role="img"
        aria-label={label}
        width={size}
        height={size}
        viewBox={`0 0 ${extent} ${extent}`}
        shapeRendering="crispEdges"
      >
        <rect width={extent} height={extent} fill="#fff" />
        <path d={path} fill="#000" />
      </svg>
    </Box>
  );
}
