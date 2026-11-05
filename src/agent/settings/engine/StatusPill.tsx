// C3Theme
import { StatusChip } from '@c3theme/ui';
import type { StatusTone } from '@c3theme/ui';

import { STATUS, type ActivityStatus } from './types';

const TONE: Record<ActivityStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  waiting_approval: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Situação do pedido no motor; mesmos textos do selo antigo, agora no `StatusChip` do pacote. */
export function StatusPill({ status }: { status: ActivityStatus }) {
  return <StatusChip label={STATUS[status]} tone={TONE[status]} />;
}
