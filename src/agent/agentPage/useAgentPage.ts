import { useEffect, useState } from 'react';
import type { RosterAgent, SalarySheet, Skill } from '../adminTypes';
import type { AgentRun } from '../agentRuns/types';
import { useLiveControls } from '../agentRuns/useLiveControls';
import { isFinal, type EngineActivity } from '../settings/engine/types';
import { useFetch } from '../useFetch';
import type { AgentHistory } from './types';

/** Período padrão da página, em dias. */
export const DAYS = 30;

/** Tudo o que a página de um agente mostra, buscado das APIs que as outras telas já usam. */
export function useAgentPage(agentId: number, allRuns: AgentRun[], onRunsChanged?: () => void) {
  const roster = useFetch<RosterAgent[]>('/agent_directory');
  const skills = useFetch<Skill[]>('/skills');
  const history = useFetch<AgentHistory>(`/agent_directory/${agentId}/history?days=${DAYS}`);
  // O motor pode estar desligado (503): a página segue sem os pedidos.
  const engine = useFetch<EngineActivity[]>('/engine/activities');
  const sheet = useFetch<SalarySheet>('/agent_directory/salaries');
  const controls = useLiveControls(onRunsChanged);
  const [now, setNow] = useState(() => Date.now());
  const activities = (engine.data || []).filter((a) => a.agent_id === agentId);
  const open = activities.some((a) => !isFinal(a.status));
  const reloadEngine = engine.reload;

  // Enquanto há pedido em aberto, atualiza a cada 5 s (o motor não emite evento na página).
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      reloadEngine();
      setNow(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, reloadEngine]);

  const agent = roster.data?.find((a) => a.id === agentId) ?? null;
  const salaries = Array.isArray(sheet.data?.salaries) ? sheet.data : null;
  return {
    agent,
    roster: roster.data || [],
    skills: skills.data || [],
    history: history.data,
    activities,
    runs: allRuns.filter((r) => r.agent_id === agentId),
    salary: salaries?.salaries.find((s) => s.agent_id === agentId),
    rates: salaries?.rates,
    controls,
    paused: controls.paused(agentId),
    now,
    loading: roster.loading && !roster.data,
    error: roster.error || history.error,
    reload: () => {
      roster.reload();
      skills.reload();
      history.reload();
      engine.reload();
      sheet.reload();
      setNow(Date.now());
    },
    reloadSkills: skills.reload,
    reloadEngine,
  };
}

export type AgentPageData = ReturnType<typeof useAgentPage>;
