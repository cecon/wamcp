import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { SidePanel } from '../../ui/Overlay';
import { useAction } from '../useAction';
import { StatusPill } from './StatusPill';
import { CALL_STATUS, isFinal, type ActivityDetail, type EngineRun } from './types';

interface Props {
  id: number;
  name: (agentId: number) => string;
  onClose: () => void;
  onChanged: () => void;
}

function usage(runs: EngineRun[]) {
  const tokens = runs.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);
  const cost = runs.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  const estimated = runs.some((r) => r.cost_source === 'estimated');
  return `${runs.length} execução${runs.length === 1 ? '' : 'ões'} · ${tokens.toLocaleString('pt-BR')} tokens · US$ ${cost.toFixed(4)}${estimated ? ' (estimado)' : ''}`;
}

/** One request end to end: the delegation tree, tool calls (with approvals), evidence, usage and audit. */
export function ActivityPanel({ id, name, onClose, onChanged }: Props) {
  const { data, error, reload } = useFetch<ActivityDetail>(`/engine/activities/${id}`);
  const action = useAction();
  const done = data ? isFinal(data.activity.status) : false;

  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(reload, 2000);
    return () => window.clearInterval(timer);
  }, [done, reload]);

  const decide = (callId: number, approve: boolean) =>
    void action.run(async () => {
      await http(`/engine/tool_calls/${callId}/decision`, 'POST', { approve });
      reload();
      onChanged();
    });

  return (
    <SidePanel title={`Pedido #${id}`} onClose={onClose}>
      <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5 text-sm">
        {(error || action.error) && (
          <p role="alert" className="text-n-ruby-11">
            {error || action.error}
          </p>
        )}
        {!data && !error && <p className="text-n-slate-11">Carregando…</p>}
        {data?.tree.map(({ activity, runs, tool_calls, evidence, messages }) => {
          const delegation = data.delegations.find((d) => d.activity_id === activity.id);
          return (
            <section
              key={activity.id}
              aria-label={`Atividade de ${name(activity.agent_id)}`}
              className={`flex flex-col gap-2 rounded-lg border border-n-weak p-4 ${activity.parent_id ? 'ms-6' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-n-slate-12">
                  {name(activity.agent_id)}
                  {delegation && (
                    <span className="font-normal text-n-slate-11">
                      {' '}
                      · delegado por {name(delegation.from_agent_id)} (skill {delegation.skill}, salto{' '}
                      {delegation.hops})
                    </span>
                  )}
                </span>
                <StatusPill status={activity.status} />
              </div>
              <p className="text-n-slate-11">Pedido: {activity.request}</p>
              {activity.result && <p className="text-n-slate-12">Resposta: {activity.result}</p>}
              {activity.error && <p className="text-n-ruby-11">Erro: {activity.error}</p>}
              {activity.evidence.length > 0 && (
                <p className="text-xs text-n-slate-11">Evidências citadas: {activity.evidence.join(', ')}</p>
              )}
              {tool_calls.map((call) => (
                <div
                  key={call.id}
                  className="flex flex-wrap items-center gap-2 rounded-md bg-n-alpha-1 px-3 py-2"
                >
                  <code className="text-xs">{call.tool}</code>
                  <span className="text-xs text-n-slate-11">{JSON.stringify(call.args)}</span>
                  <span className="text-xs text-n-slate-12">→ {CALL_STATUS[call.status]}</span>
                  {call.evidence_id && <span className="text-xs text-n-slate-11">({call.evidence_id})</span>}
                  {call.status === 'pending_approval' && (
                    <span className="ms-auto flex gap-1">
                      <Button
                        size="sm"
                        icon={Check}
                        label="Aprovar"
                        disabled={action.busy}
                        onClick={() => decide(call.id, true)}
                      />
                      <Button
                        size="sm"
                        color="ruby"
                        variant="faded"
                        icon={X}
                        label="Recusar"
                        disabled={action.busy}
                        onClick={() => decide(call.id, false)}
                      />
                    </span>
                  )}
                </div>
              ))}
              {evidence.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-n-slate-11">
                    Evidências ({evidence.length})
                  </summary>
                  {evidence.map((e) => (
                    <pre key={e.id} className="mt-1 overflow-x-auto rounded bg-n-alpha-1 p-2 text-xs">
                      {e.id} · {e.source}
                      {'\n'}
                      {JSON.stringify(e.content, null, 2)}
                    </pre>
                  ))}
                </details>
              )}
              {messages.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs text-n-slate-11">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium text-n-slate-12">
                        {m.from_agent_id ? name(m.from_agent_id) : '—'} →{' '}
                        {m.to_agent_id ? name(m.to_agent_id) : '—'}:
                      </span>{' '}
                      {m.body}
                    </li>
                  ))}
                </ul>
              )}
              {runs.length > 0 && <p className="text-xs text-n-slate-11">{usage(runs)}</p>}
            </section>
          );
        })}
        {data && data.audit.length > 0 && (
          <details>
            <summary className="cursor-pointer text-n-slate-12">Auditoria ({data.audit.length})</summary>
            <ol className="mt-2 flex flex-col gap-1 text-xs text-n-slate-11">
              {data.audit.map((a) => (
                <li key={a.id}>
                  {new Date(a.at).toLocaleTimeString('pt-BR')} · {a.agent_id ? name(a.agent_id) : 'Sistema'} ·{' '}
                  {a.action} · {a.outcome}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </SidePanel>
  );
}
