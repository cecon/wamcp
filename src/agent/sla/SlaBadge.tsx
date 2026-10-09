import { Timer } from 'lucide-react';
import type { SlaStatus } from '../types';
import { cn } from '../ui/cn';

const BADGE: Partial<Record<SlaStatus, { title: string; className: string }>> = {
  missed: { title: 'SLA perdido', className: 'bg-n-ruby-2 text-n-ruby-11 outline-n-ruby-4' },
  active: { title: 'SLA em andamento', className: 'bg-n-alpha-2 text-n-slate-11 outline-n-weak' },
};

/** Chatwoot conversation card SLA badge: red when missed, neutral while running (nothing when met). */
export function SlaBadge({ status }: { status?: SlaStatus | null }) {
  const badge = status ? BADGE[status] : undefined;
  if (!badge) return null;
  return (
    <span
      title={badge.title}
      aria-label={badge.title}
      className={cn(
        'flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium outline outline-1 -outline-offset-1',
        badge.className,
      )}
    >
      <Timer size={12} />
      SLA
    </span>
  );
}
