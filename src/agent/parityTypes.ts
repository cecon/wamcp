import type { Contact, Conversation } from './types';

/** Types of the account, search, reports v2 and SLA APIs (Chatwoot parity). */
export type Locale = 'pt-BR' | 'en' | 'es';
export interface Account {
  id: number;
  name: string;
  locale: Locale;
  settings: { auto_resolve_duration?: number | null; auto_resolve_message?: string | null } | null;
}

export type SearchType = 'all' | 'conversations' | 'contacts' | 'messages';
export interface MessageHit {
  id: number;
  content: string | null;
  message_type: 'incoming' | 'outgoing';
  created_at: number;
  conversation_id: number;
  display_id: number;
  contact_name: string | null;
}
export interface SearchResults {
  conversations?: Conversation[];
  contacts?: Contact[];
  messages?: MessageHit[];
}

export type MetricKey =
  | 'conversations_count'
  | 'incoming_messages_count'
  | 'outgoing_messages_count'
  | 'resolutions_count'
  | 'avg_first_response_time'
  | 'avg_resolution_time';
export type ReportSummary = Record<MetricKey, { current: number; previous: number }>;
export interface ReportPoint {
  timestamp: number;
  value: number;
}
export type BreakdownRow = { id: number | null; name: string } & Record<MetricKey, number>;
export interface CsatMetrics {
  total: number;
  sent: number;
  ratings: Record<'1' | '2' | '3' | '4' | '5', number>;
  average: number | null;
  satisfaction_score: number | null;
  response_rate: number | null;
}
export interface BotMetrics {
  conversations: number;
  resolutions: number;
  handoffs: number;
  resolution_rate: number | null;
  handoff_rate: number | null;
}
/** Counts are 0 when nothing was applied (older servers sent `null`; the UI accepts both). */
export interface SlaMetrics {
  total: number;
  hit: number | null;
  missed: number | null;
  active: number | null;
  hit_rate: number | null;
}

export interface SlaPolicy {
  id: number;
  name: string;
  description: string | null;
  first_response_time_threshold: number | null;
  next_response_time_threshold: number | null;
  resolution_time_threshold: number | null;
}
export type SlaTarget = 'first_response' | 'next_response' | 'resolution';
export interface ConversationSla {
  policy: SlaPolicy;
  applied: { sla_policy_id: number; created_at: number; status: string; missed_at: number | null };
  state: {
    status: 'active' | 'hit' | 'missed';
    first_response_due_at: number | null;
    next_response_due_at: number | null;
    resolution_due_at: number | null;
    missed: SlaTarget[];
  };
}
