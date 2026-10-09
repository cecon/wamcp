import { useState } from 'react';
import { http } from '../api';
import type { ConversationSla } from '../parityTypes';
import { formatSeconds } from '../reports/metrics';
import { useFetch } from '../useFetch';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { THRESHOLDS, useSlaPolicies } from './sla';
import { useNow } from './useNow';

const STATUS: Record<ConversationSla['state']['status'], [string, string]> = {
  active: ['Em andamento', 'bg-n-blue-3 text-n-blue-11'],
  hit: ['Cumprido', 'bg-n-teal-3 text-n-teal-11'],
  missed: ['Perdido', 'bg-n-ruby-2 text-n-ruby-11'],
};
const badge = 'rounded-md px-1.5 py-0.5 text-xs font-medium';
const DUE: Record<string, 'first_response_due_at' | 'next_response_due_at' | 'resolution_due_at'> = {
  first_response: 'first_response_due_at',
  next_response: 'next_response_due_at',
  resolution: 'resolution_due_at',
};

/** One SLA target: countdown while running, "perdido" once late, "—" when met or not applicable. */
function Deadline({ due, missed, now }: { due: number | null; missed: boolean; now: number }) {
  if (missed || (due !== null && due <= now))
    return <span className={cn(badge, STATUS.missed[1])}>perdido</span>;
  if (due === null) return <span className="text-n-slate-11">—</span>;
  return <span className="text-n-slate-12">vence em {formatSeconds(due - now)}</span>;
}

/** Chatwoot conversation SLA: applied policy, its deadlines and a selector to apply another one. */
export function SlaSection({ displayId }: { displayId: number }) {
  const path = `/conversations/${displayId}/sla`;
  const current = useFetch<ConversationSla | null>(path);
  const { policies } = useSlaPolicies();
  const [applied, setApplied] = useState<ConversationSla | null>(null),
    [choice, setChoice] = useState(''),
    [error, setError] = useState('');
  const now = useNow();
  const sla = applied || current.data;
  const apply = () =>
    http<ConversationSla>(path, 'POST', { sla_policy_id: Number(choice) })
      .then((result) => {
        setApplied(result);
        setChoice('');
        setError('');
      })
      .catch((e: Error) => setError(e.message));

  return (
    <div className="flex flex-col gap-3 text-sm">
      {sla ? (
        <>
          <p className="flex items-center justify-between gap-2">
            <span className="font-medium text-n-slate-12">{sla.policy.name}</span>
            <span className={cn(badge, STATUS[sla.state.status][1])}>{STATUS[sla.state.status][0]}</span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {THRESHOLDS.filter(({ key }) => sla.policy[key]).map(({ target, label }) => (
              <div key={target} className="contents">
                <dt className="text-n-slate-11">{label}</dt>
                <dd>
                  <Deadline
                    due={sla.state[DUE[target]]}
                    missed={sla.state.missed.includes(target)}
                    now={now}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        !current.loading && <p className="text-n-slate-11">Nenhum SLA aplicado.</p>
      )}
      {(error || current.error) && <p className="text-n-ruby-11">{error || current.error}</p>}
      <div className="flex items-center gap-2">
        <select
          aria-label="Política de SLA"
          className="field !h-8 !py-1"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">{sla ? 'Trocar SLA…' : 'Selecione um SLA…'}</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button color="slate" label="Aplicar" disabled={!choice} onClick={() => void apply()} />
      </div>
    </div>
  );
}
