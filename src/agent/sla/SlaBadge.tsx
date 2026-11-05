// material-ui
import Chip from '@mui/material/Chip';

// third-party
import { Timer } from 'lucide-react';

import type { SlaStatus } from '../types';

const BADGE: Partial<Record<SlaStatus, { title: string; className: string }>> = {
  missed: { title: 'SLA perdido', className: 'bg-n-ruby-2 text-n-ruby-11 outline-n-ruby-4' },
  active: { title: 'SLA em andamento', className: 'bg-n-alpha-2 text-n-slate-11 outline-n-weak' },
};

/** Chatwoot conversation card SLA badge: red when missed, neutral while running (nothing when met). */
export function SlaBadge({ status }: { status?: SlaStatus | null }) {
  const badge = status ? BADGE[status] : undefined;
  if (!badge) return null;
  return (
    <Chip
      title={badge.title}
      aria-label={badge.title}
      className={badge.className}
      icon={<Timer size={12} />}
      label="SLA"
      size="small"
      sx={{
        height: 20,
        borderRadius: 1,
        fontSize: 12,
        fontWeight: 500,
        '& .MuiChip-icon': { ml: 0.75, mr: -0.25 },
        '& .MuiChip-label': { px: 0.5 },
      }}
    />
  );
}
