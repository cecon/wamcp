import { useEffect } from 'react';
import { useFetch } from '../../useFetch';
import { RUN_LABEL, formatTime, type AgentSchedule, type ScheduleRun } from './types';

const TONE: Record<ScheduleRun['status'], string> = {
  running: 'bg-n-blue-3 text-n-blue-11',
  done: 'bg-n-teal-3 text-n-teal-11',
  failed: 'bg-n-ruby-3 text-n-ruby-11',
  skipped: 'bg-n-amber-3 text-n-amber-11',
};

/** The newest runs of a schedule, refreshed while one is going on. */
export function RunHistory({ schedule, refresh }: { schedule: AgentSchedule; refresh: number }) {
  const { data, error, reload } = useFetch<ScheduleRun[]>(`/agent_schedules/${schedule.id}/runs`);
  const running = data?.some((r) => r.status === 'running');
  useEffect(reload, [refresh, reload]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [running, reload]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-n-ruby-11">
        {error}
      </p>
    );
  }
  if (data?.length === 0) return <p className="text-sm text-n-slate-11">Nenhuma execução ainda.</p>;
  return (
    <ol className="flex flex-col gap-3" aria-label="Execuções">
      {data?.map((run) => (
        <li key={run.id} className="rounded-xl p-3 outline outline-1 -outline-offset-1 outline-n-weak">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-n-slate-12">{run.agent_name ?? `Agente ${run.agent_id}`}</span>
            <span className={`rounded-md px-2 py-0.5 text-xs ${TONE[run.status]}`}>
              {RUN_LABEL[run.status]}
            </span>
          </div>
          <p className="text-xs text-n-slate-11">
            {formatTime(run.started_at, schedule.timezone)}
            {run.finished_at && run.status !== 'skipped' && (
              <> · {Math.max(0, Math.round((run.finished_at - run.started_at) / 1000))} s</>
            )}
          </p>
          {run.output && <p className="mt-2 whitespace-pre-wrap text-sm text-n-slate-12">{run.output}</p>}
          {run.error && <p className="mt-2 text-sm text-n-ruby-11">{run.error}</p>}
        </li>
      ))}
    </ol>
  );
}
