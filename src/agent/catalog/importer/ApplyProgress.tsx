import { Loader2 } from 'lucide-react';
import type { ImportJob } from '../types';

/** Applying the import: a bar over the photo downloads, then saving the menu. */
export function ApplyProgress({ progress }: { progress?: ImportJob['progress'] }) {
  const done = progress?.done ?? 0,
    total = progress?.total ?? 0;
  const saving = Boolean(progress) && done >= total;
  const percent = saving ? 100 : total ? Math.round((done / total) * 100) : 0;
  const label = !progress
    ? 'Preparando a importação…'
    : saving
      ? 'Gravando o cardápio…'
      : `Baixando fotos: ${done} de ${total}`;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-n-slate-2 p-4">
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-n-slate-12">
        <Loader2 size={16} className="shrink-0 animate-spin text-n-brand" />
        {label}
      </p>
      <div
        role="progressbar"
        aria-label="Progresso da importação"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-n-slate-4"
      >
        <div className="h-full rounded-full bg-n-brand transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
