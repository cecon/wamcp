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
  greeting_enabled: number;
  greeting_message: string | null;
  working_hours_enabled: number;
  out_of_office_message: string | null;
  csat_survey_enabled: number;
  timezone: string;
}
export interface WorkingDay {
  day_of_week: number;
  closed_all_day: number | boolean;
  open_minutes: number;
  close_minutes: number;
}
export interface Webhook {
  id: number;
  url: string;
  subscriptions: string[];
  inbox_id: number | null;
  secret: string;
  active: number;
}
export interface Delivery {
  id: number;
  event: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: number;
}
export interface Condition {
  attribute_key: string;
  filter_operator: string;
  values: (string | number)[];
  query_operator: 'and' | 'or';
}
export interface Action {
  action_name: string;
  action_params: (string | number)[];
}
export interface AutomationRule {
  id: number;
  name: string;
  event_name: string;
  conditions: Condition[];
  actions: Action[];
  active: number;
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
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
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
  content_attributes: { external_error?: string; automated?: string };
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
