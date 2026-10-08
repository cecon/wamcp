import { cn } from '../../ui/cn';
import { statusLabel } from './model';

/** Status pill: green when connected, amber while pairing, slate otherwise. */
export function ConnectionStatus({ status }: { status: string }) {
  const tone =
    status === 'connected'
      ? 'bg-n-teal-3 text-n-teal-11'
      : ['qr', 'connecting', 'reconnecting'].includes(status)
        ? 'bg-n-amber-3 text-n-amber-11'
        : status === 'error'
          ? 'bg-n-ruby-2 text-n-ruby-11'
          : 'bg-n-slate-3 text-n-slate-11';
  return (
    <span
      className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium', tone)}
      data-status={status}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}
