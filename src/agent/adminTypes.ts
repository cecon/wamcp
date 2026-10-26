/** Types of the profiles (custom roles), agent roster and skills APIs. */
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
  /** The AI role agents with this profile play (coordinator, operator…), or none. */
  agent_role: RosterRole | null;
  /** The built-in "Padrão" profile: every agent has a profile and it cannot be deleted. */
  builtin: boolean;
}

/** Agent roster (`/agent_directory`): human agents consulted on WhatsApp and AI agents run by a runtime. */
export type RosterKind = 'human' | 'ai';
export type RosterRole = 'coordinator' | 'operator' | 'dev_support' | 'qa';
export interface RosterAgent {
  id: number;
  name: string;
  kind: RosterKind;
  /** From the profile. */
  role: RosterRole;
  profile_id: number | null;
  profile_name: string | null;
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
