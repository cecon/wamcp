import type { Action } from './types';

/** Types of the notifications, macros and account security APIs. */
export type NotificationType =
  | 'conversation_creation'
  | 'conversation_assignment'
  | 'assigned_conversation_new_message'
  | 'conversation_mention'
  | 'participating_conversation_new_message';

export interface NotificationSettings {
  flags: Record<string, boolean>;
}

export type MacroVisibility = 'personal' | 'global';
export interface Macro {
  id: number;
  name: string;
  visibility: MacroVisibility;
  created_by: number | null;
  created_by_name: string | null;
  actions: Action[];
  created?: string;
}

export interface MfaSetup {
  secret: string;
  otpauth_uri: string;
}

export interface SessionInfo {
  id: string;
  created: string;
  expires: string;
  last_seen: string | null;
  user_agent: string | null;
  current: boolean;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  auditable_type: string;
  auditable_id: number | null;
  details: { method?: string; path?: string } | null;
  ip_address: string | null;
  created_at: number;
}
