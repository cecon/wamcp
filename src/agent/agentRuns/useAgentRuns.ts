import { useCallback, useEffect, useState } from 'react';
import { http, REALTIME_RECONNECTED, type Realtime } from '../api';
import type { AgentRun } from './types';

/** Lista viva das execuções: carrega uma vez e segue os eventos `agent_run.*` do stream. */
export function useAgentRuns(realtime: Realtime) {
  const [runs, setRuns] = useState<AgentRun[]>([]),
    [error, setError] = useState('');
  const reload = useCallback(
    () =>
      void http<AgentRun[]>('/agent_runs')
        .then((list) => {
          setRuns(list);
          setError('');
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    const initial = setTimeout(reload, 0);
    // O motor guarda as atividades em tabelas, sem evento: um recarregamento lento as mantém em dia.
    const poll = setInterval(reload, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
    };
  }, [reload]);
  useEffect(
    () =>
      realtime.subscribe(({ event, data }) => {
        if (event === REALTIME_RECONNECTED) return reload();
        if (!event.startsWith('agent_run.')) return;
        const run = data as unknown as AgentRun;
        setRuns((current) => {
          const others = current.filter((r) => r.id !== run.id);
          return event === 'agent_run.finished' ? others : [...others, run];
        });
      }),
    [realtime, reload],
  );
  return { runs, error, reload };
}
