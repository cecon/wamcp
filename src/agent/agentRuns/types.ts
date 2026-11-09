/** Uma execução de agente de IA em andamento (`GET /agent_runs`, eventos `agent_run.*`). */
export interface AgentRun {
  /** `conversation:12`, `chat:3`, `schedule:4:7` ou `engine:9`. */
  id: string;
  kind: 'conversation' | 'chat' | 'schedule' | 'engine';
  /** `queued`, `running` ou, no motor, o status da atividade (`waiting_approval`). */
  state: string;
  agent_id: number | null;
  agent_name: string | null;
  title: string;
  inbox_id: number | null;
  inbox_name: string | null;
  display_id: number | null;
  owner_id: number | null;
  /** Último passo informado pelo runtime. */
  detail: string | null;
  /** Chegou mensagem nova durante a execução: roda de novo depois. */
  again: boolean;
  queued_at: number;
  started_at: number | null;
  updated_at: number;
}

export const STATE_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Trabalhando',
  waiting_approval: 'Esperando aprovação',
};

export const KIND_LABEL: Record<AgentRun['kind'], string> = {
  conversation: 'Conversa',
  chat: 'Chat interno',
  schedule: 'Agendamento',
  engine: 'Motor',
};

/** `1:05`, `12:40`, `1h02` desde `since` (ms). */
export function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h${String(minutes).padStart(2, '0')}`;
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
