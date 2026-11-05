// material-ui
import Box from '@mui/material/Box';

import { statusLabel } from './model';

const TONE: Record<string, { bgcolor: string; color: string }> = {
  connected: { bgcolor: 'var(--color-n-teal-3)', color: 'var(--color-n-teal-11)' },
  pair: { bgcolor: 'var(--color-n-amber-3)', color: 'var(--color-n-amber-11)' },
  error: { bgcolor: 'var(--color-n-ruby-2)', color: 'var(--color-n-ruby-11)' },
  default: { bgcolor: 'var(--color-n-slate-3)', color: 'var(--color-n-slate-11)' },
};

/** Status pill: green when connected, amber while pairing, slate otherwise. */
export function ConnectionStatus({ status }: { status: string }) {
  const tone =
    status === 'connected'
      ? TONE.connected
      : ['qr', 'connecting', 'reconnecting'].includes(status)
        ? TONE.pair
        : status === 'error'
          ? TONE.error
          : TONE.default;
  return (
    <Box
      component="span"
      data-status={status}
      sx={{
        display: 'inline-flex',
        height: 24,
        alignItems: 'center',
        gap: 0.75,
        borderRadius: 1,
        px: 1,
        fontSize: 12,
        fontWeight: 500,
        ...tone,
      }}
    >
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }} />
      {statusLabel(status)}
    </Box>
  );
}
