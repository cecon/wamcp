import { formatTime } from '../api';
import type { Delivery } from '../types';
import { WEBHOOK_EVENTS } from '../labels';
import { cn } from '../ui/cn';
import { SidePanel } from '../ui/Overlay';

const STATUS: Record<Delivery['status'], [string, string]> = {
  pending: ['pendente', 'text-n-amber-11'],
  sent: ['entregue', 'text-n-teal-11'],
  failed: ['falhou', 'text-n-ruby-11'],
};

interface Props {
  /** Destination shown under the title (webhook or bot URL). */
  target: string;
  list: Delivery[];
  onClose: () => void;
}

/** Recent deliveries of a webhook or agent bot: event, time, status and attempts. */
export function DeliveriesPanel({ target, list, onClose }: Props) {
  return (
    <SidePanel title="Entregas recentes" onClose={onClose}>
      <p className="mb-4 text-sm break-all text-n-slate-11">{target}</p>
      {list.length === 0 && <p className="text-sm text-n-slate-11">Nenhuma entrega ainda.</p>}
      <ul className="divide-y divide-n-weak">
        {list.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="font-medium text-n-slate-12">{WEBHOOK_EVENTS[d.event] || d.event}</span>
              <span className="text-n-slate-11"> · {formatTime(d.created_at)}</span>
            </span>
            <span className={cn('text-right', STATUS[d.status][1])}>
              {STATUS[d.status][0]} ({d.attempts}x){d.last_error ? ` · ${d.last_error}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}
