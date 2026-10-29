/** The agentic engine as the API returns it (see docs/engine/spec.md). */
export type ActivityStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface EngineActivity {
  id: number;
  requester: string;
  agent_id: number;
  parent_id: number | null;
  status: ActivityStatus;
  request: string;
  result: string | null;
  evidence: string[];
  error: string | null;
  conversation_id: number | null;
  correlation_id: string;
  attempts: number;
  created: string;
  updated: string;
}

export interface EngineRun {
  id: number;
  runtime: string;
  model: string | null;
  status: string;
  attempt: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number | null;
  cost_source: 'reported' | 'estimated' | null;
  error: string | null;
  started: string;
}

export interface EngineToolCall {
  id: number;
  agent_id: number;
  tool: string;
  args: Record<string, unknown>;
  status: 'ok' | 'denied' | 'failed' | 'pending_approval' | 'rejected';
  result: unknown;
  evidence_id: string | null;
}

export interface EngineEvidence {
  id: string;
  source: string;
  content: unknown;
}

export interface EngineMessage {
  id: number;
  from_agent_id: number | null;
  to_agent_id: number | null;
  body: string;
  created: string;
}

export interface EngineAudit {
  id: number;
  activity_id: number | null;
  agent_id: number | null;
  action: string;
  outcome: string;
  at: string;
}

export interface EngineDelegation {
  id: number;
  activity_id: number;
  from_agent_id: number;
  to_agent_id: number;
  skill: string;
  hops: number;
}

export interface ActivityDetail {
  activity: EngineActivity;
  delegations: EngineDelegation[];
  tree: {
    activity: EngineActivity;
    runs: EngineRun[];
    tool_calls: EngineToolCall[];
    evidence: EngineEvidence[];
    messages: EngineMessage[];
  }[];
  audit: EngineAudit[];
}

export type ExecutionPolicy = 'suggest_only' | 'approval_for_sensitive' | 'within_grants';

export interface EnginePolicy {
  agent_id: number;
  enabled: boolean;
  proactive_enabled: boolean;
  execution_policy: ExecutionPolicy;
  max_concurrency: number;
  run_timeout_secs: number;
  monthly_token_budget: number | null;
}

export interface EngineGrant {
  tool: string;
  effect: 'allow' | 'approval';
}

export interface EngineCatalog {
  tools: { name: string; description: string; builtin: boolean; side_effects: boolean; sensitive: boolean }[];
  runtimes: { id: string; available: boolean; detail: string | null }[];
}

export const STATUS: Record<ActivityStatus, string> = {
  queued: 'Na fila',
  running: 'Em andamento',
  waiting_approval: 'Aguardando aprovação',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export const CALL_STATUS: Record<EngineToolCall['status'], string> = {
  ok: 'executada',
  denied: 'negada (sem permissão)',
  failed: 'falhou',
  pending_approval: 'aguardando aprovação',
  rejected: 'recusada por uma pessoa',
};

export const POLICY_LABEL: Record<ExecutionPolicy, string> = {
  suggest_only: 'Só sugere: toda ação com efeito precisa de aprovação',
  approval_for_sensitive: 'Aprovação para ações sensíveis',
  within_grants: 'Age dentro das permissões dadas',
};

export const isFinal = (status: ActivityStatus) => ['completed', 'failed', 'cancelled'].includes(status);
