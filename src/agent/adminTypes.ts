/** Types of the agent bots and custom roles APIs (Chatwoot parity). */
export interface AgentBot {
  id: number;
  name: string;
  description: string | null;
  outgoing_url: string;
  inbox_ids: number[];
  /** `webhook`: external system with URL and token; `llm`: answered by the app with an LLM provider. */
  kind: 'webhook' | 'llm';
  provider: string | null;
  model: string | null;
  instructions: string | null;
}
/** POST /agent_bots: the access token is returned only once (`null` for LLM bots, which have none). */
export interface CreatedAgentBot {
  agent_bot: AgentBot;
  access_token: string | null;
}

export type Permission =
  | 'conversation_manage'
  | 'conversation_unassigned_manage'
  | 'conversation_participating_manage'
  | 'contact_manage'
  | 'report_manage';

export interface CustomRole {
  id: number;
  name: string;
  description: string | null;
  permissions: Permission[];
}
