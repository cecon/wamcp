import { useCallback, useEffect, useState } from 'react';
import { ApiError, http } from '../api';
import type { AgentRun } from './types';

/** Um agente de IA e se está pausado (`GET /agents/live`, só administradores). */
export interface LiveAgent {
  id: number;
  name: string;
  active: boolean;
  paused: boolean;
}

/** Onde parar uma sessão: encerrar a resposta (a conversa passa para uma pessoa) ou cancelar o pedido do motor. */
export function stopPath(run: AgentRun): string | null {
  const [, id] = run.id.split(':');
  if (run.kind === 'conversation') return `/agents/live/conversations/${id}/stop`;
  if (run.kind === 'chat') return `/agents/live/chats/${id}/stop`;
  if (run.kind === 'engine') return `/engine/activities/${id}/cancel`;
  return null;
}

/** Pausar, retomar e parar sessões. Quem não é administrador recebe 403 e fica sem os controles. */
export function useLiveControls(onChanged?: () => void) {
  const [agents, setAgents] = useState<LiveAgent[]>([]),
    [admin, setAdmin] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const reload = useCallback(
    () =>
      void http<LiveAgent[]>('/agents/live')
        .then((list) => {
          setAgents(list);
          setAdmin(true);
        })
        .catch((e: Error) => {
          // 403: não é administrador; 404: servidor sem os controles. Nos dois, a tela só lista.
          if (!(e instanceof ApiError && [403, 404].includes(e.status))) setError(e.message);
        }),
    [],
  );
  useEffect(() => {
    const initial = setTimeout(reload, 0);
    return () => clearTimeout(initial);
  }, [reload]);
  const act = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await call();
      reload();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {
    agents,
    admin,
    busy,
    error,
    paused: (agentId: number | null) => agents.some((a) => a.id === agentId && a.paused),
    setPaused: (agentId: number, paused: boolean) =>
      act(() => http(`/agents/live/${agentId}/paused`, 'PUT', { paused })),
    stop: (run: AgentRun) => {
      const path = stopPath(run);
      return path ? act(() => http(path, 'POST', {})) : Promise.resolve();
    },
  };
}

export type LiveControls = ReturnType<typeof useLiveControls>;
