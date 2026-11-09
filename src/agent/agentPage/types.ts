/** O que um agente de IA fez nos últimos dias (`GET /agent_directory/{id}/history`). */
export interface AgentConversation {
  id: number;
  display_id: number;
  inbox_id: number;
  inbox_name: string | null;
  contact_name: string | null;
  status: string;
  /** Vezes que o agente trabalhou nela no período (respostas e pedidos do motor). */
  turns: number;
  /** ISO. */
  first_at: string;
  last_at: string;
  /** Segundos desde a época. */
  handoff_at: number | null;
  handed_to: string | null;
  handoff_reason: string | null;
}

/** Execução de uma rotina pelo agente; horários em milissegundos. */
export interface AgentScheduleRun {
  id: number;
  schedule_id: number;
  schedule_name: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface AgentHistory {
  days: number;
  conversations: AgentConversation[];
  schedule_runs: AgentScheduleRun[];
}

/** Memória do agente no motor (`GET /engine/agents/{id}/memories`). */
export interface EngineMemory {
  id: number;
  agent_id: number;
  kind: 'episodic' | 'semantic' | 'operational' | string;
  content: string;
  source: string | null;
  visibility: 'private' | 'organization' | string;
  valid_until: string | null;
  version: number;
  created: string;
}

export const MEMORY_KIND: Record<string, string> = {
  episodic: 'Fato de uma conversa',
  semantic: 'Conhecimento',
  operational: 'Como trabalhar',
};
