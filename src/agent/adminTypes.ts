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
  /** Skills every agent of the profile inherits (only roles that execute). */
  skill_ids?: number[];
}

/** Agent roster (`/agent_directory`): human agents consulted on WhatsApp and AI agents run by a runtime. */
export type RosterKind = 'human' | 'ai';
/** An AI agent runtime and whether it is installed on this computer (`detail`: where, or why not). */
export interface RuntimeStatus {
  id: string;
  available: boolean;
  detail: string;
}
export type RosterRole = 'coordinator' | 'operator' | 'dev_support' | 'qa';
export interface RosterAgent {
  id: number;
  name: string;
  kind: RosterKind;
  /** From the profile (people may have none). */
  role: RosterRole | null;
  profile_id: number | null;
  profile_name: string | null;
  description: string | null;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  whatsapp_jid: string | null;
  runtime: string | null;
  model: string | null;
  instructions: string | null;
  active: boolean;
  skill_ids: number[];
  /** Skills inherited from the profile. */
  profile_skill_ids?: number[];
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
