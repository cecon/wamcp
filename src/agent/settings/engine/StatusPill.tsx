import { STATUS, type ActivityStatus } from './types';

const TONE: Record<ActivityStatus, string> = {
  queued: 'bg-n-slate-3 text-n-slate-11',
  running: 'bg-n-blue-3 text-n-blue-11',
  waiting_approval: 'bg-n-amber-3 text-n-amber-11',
  completed: 'bg-n-teal-3 text-n-teal-11',
  failed: 'bg-n-ruby-3 text-n-ruby-11',
  cancelled: 'bg-n-slate-3 text-n-slate-11',
};

export function StatusPill({ status }: { status: ActivityStatus }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[status]}`}
    >
      {STATUS[status]}
    </span>
  );
}
