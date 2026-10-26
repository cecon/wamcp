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

/** Agent roster (`/agent_directory`): human agents consulted on WhatsApp and AI agents run by a runtime. */
export type RosterKind = 'human' | 'ai';
export type RosterRole = 'coordinator' | 'operator' | 'dev_support' | 'qa';
export interface RosterAgent {
  id: number;
  name: string;
  kind: RosterKind;
  role: RosterRole;
  description: string | null;
  user_id: number | null;
  user_name: string | null;
  whatsapp_jid: string | null;
  runtime: string | null;
  model: string | null;
  instructions: string | null;
  active: boolean;
  skill_ids: number[];
  credential_count: number;
}
export interface Skill {
  id: number;
  name: string;
  description: string | null;
  instructions: string;
  tools: string[];
}
/** A credential of an AI agent; the secret is write-only. */
export interface AgentCredential {
  id: number;
  agent_id: number;
  name: string;
  kind: 'api_key' | 'bearer' | 'basic' | 'secret';
  created: string;
  last_used: string | null;
}
