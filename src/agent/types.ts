export type Role = 'administrator' | 'agent';
export type Availability = 'online' | 'busy' | 'offline';
export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'snoozed';

export interface User {
  id: number;
  email: string;
  name: string;
  display_name: string | null;
  role: Role;
  availability: Availability;
  active: number;
  inbox_ids?: number[];
}
export interface Inbox {
  id: number;
  name: string;
  session_id: string;
  session_status: string;
  phone: string | null;
  enable_auto_assignment: number;
  lock_to_single_conversation: number;
  ignore_groups: number;
  agent_bot_enabled: number;
}
export interface Team {
  id: number;
  name: string;
  description: string | null;
  allow_auto_assign: number;
  member_count?: number;
}
export interface Label {
  id: number;
  title: string;
  description: string | null;
  color: string;
}
export interface Canned {
  id: number;
  short_code: string;
  content: string;
}
export interface Conversation {
  id: number;
  display_id: number;
  inbox_id: number;
  inbox_name: string;
  contact_id: number;
  contact_name: string | null;
  contact_phone: string | null;
  contact_jid: string;
  status: ConversationStatus;
  assignee_id: number | null;
  assignee_name: string | null;
  team_id: number | null;
  team_name: string | null;
  labels: string[];
  last_message: string | null;
  last_activity_at: number;
  unread_count: number;
  snoozed_until: number | null;
  agent_bot_enabled: number;
}
export interface Message {
  id: number;
  conversation_id: number;
  message_type: 'incoming' | 'outgoing' | 'activity' | 'template';
  content: string | null;
  content_type: string;
  private: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sender_type: 'user' | 'contact' | 'agent_bot' | 'system' | null;
  sender_name: string | null;
  content_attributes: { external_error?: string };
  created_at: number;
}
export interface HistoryMessage {
  id: string;
  body: string;
  from_me: number;
  ts: number;
}
export interface Contact {
  id: number;
  name: string | null;
  phone_number: string | null;
  email: string | null;
  identifier: string | null;
  blocked: number;
  last_activity_at: number | null;
  conversations?: Conversation[];
}
export interface AppNotification {
  id: number;
  notification_type: string;
  display_id: number | null;
  contact_name: string | null;
  actor_name: string | null;
  read_at: number | null;
  created_at: number;
}
export interface Meta {
  mine: number;
  unassigned: number;
  all: number;
}
export interface Catalog {
  inboxes: Inbox[];
  agents: User[];
  teams: Team[];
  labels: Label[];
}
