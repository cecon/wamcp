import { Check, Loader2, MousePointerClick } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { ImportJob, ImportStatus } from '../types';

const STEPS = ['Abrindo navegador', 'Aguardando verificação', 'Lendo cardápio', 'Prévia'];
const STEP_OF: Partial<Record<ImportStatus, number>> = {
  starting: 0,
  opening: 0,
  waiting_human: 1,
  loading: 2,
  ready: 3,
  applied: 4,
};

/** Crawler progress: Abrindo navegador → Aguardando verificação → Lendo cardápio → Prévia. */
export function ImportSteps({ job }: { job: ImportJob }) {
  const current = STEP_OF[job.status] ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Andamento da importação" className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => {
          const state = i < current ? 'concluída' : i === current ? 'em andamento' : 'pendente';
          return (
            <li
              key={label}
              aria-current={i === current ? 'step' : undefined}
              aria-label={`${label}: ${state}`}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1 text-sm outline outline-1 -outline-offset-1',
                i < current && 'text-n-teal-11 outline-n-weak',
                i === current && 'bg-n-brand/10 font-medium text-n-blue-11 outline-n-brand',
                i > current && 'text-n-slate-10 outline-n-weak',
              )}
            >
              {i < current ? (
                <Check size={14} />
              ) : i === current && current < 3 ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <span className="text-xs">{i + 1}</span>
              )}
              {label}
            </li>
          );
        })}
      </ol>
      {job.status === 'waiting_human' && (
        <div role="status" className="flex gap-3 rounded-xl bg-n-solid-amber p-4 text-sm text-n-slate-12">
          <MousePointerClick size={20} className="shrink-0 text-n-amber-11" />
          <div>
            <p className="font-medium">
              Uma janela do navegador abriu no computador do WA MCP. Se o iFood pedir 'Confirme que é humano',
              clique lá para continuar.
            </p>
            {job.message && <p className="mt-1 text-n-slate-11">{job.message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
