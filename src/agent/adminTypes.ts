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
  /** Who the agent answers to in the organization (a coordinator or a person). */
  supervisor_id?: number | null;
  /** Avatar choices; `{}` uses the defaults. */
  avatar?: AvatarChoices;
  /** People with a login: their availability. */
  availability?: 'online' | 'busy' | 'offline' | null;
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
/** Parts of a member's avatar (see AVATAR_PARTS in the backend). */
export interface AvatarChoices {
  skin?: string;
  hair?: string;
  outfit?: string;
  accessory?: string;
  color?: string;
}
/** How salaries are computed (account settings). */
export interface SalaryRates {
  seat_price_brl: number;
  ai_margin_percent: number;
  usd_brl_rate: number;
}
/** A member's salary for the month: a person's seat, or an AI agent's token cost plus the margin. */
export interface Salary {
  agent_id: number;
  kind: RosterKind;
  salary_brl: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** Calls whose runtime reported no cost (not in the salary). */
  unpriced_calls: number;
}
export interface SalarySheet {
  month: string;
  rates: SalaryRates;
  salaries: Salary[];
}
/** One day of an AI agent's token usage. */
export interface UsageDay {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}
