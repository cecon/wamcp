/** Types of the agent bots and custom roles APIs (Chatwoot parity). */
export interface AgentBot {
  id: number;
  name: string;
  description: string | null;
  outgoing_url: string;
  inbox_ids: number[];
}
/** POST /agent_bots: the access token is returned only once. */
export interface CreatedAgentBot {
  agent_bot: AgentBot;
  access_token: string;
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
