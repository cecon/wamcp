import type { Conversation, Inbox, Label, Message, Team, User } from '../../src/agent/types';
import type { Route } from './fake-api';

export const admin: User = {
  id: 1,
  email: 'admin@example.com',
  name: 'Admin',
  display_name: null,
  role: 'administrator',
  availability: 'online',
  active: 1,
  inbox_ids: [10],
};
export const maria: User = {
  ...admin,
  id: 2,
  email: 'maria@example.com',
  name: 'Maria Souza',
  role: 'agent',
  availability: 'busy',
};
export const inbox: Inbox = {
  id: 10,
  name: 'Suporte',
  session_id: 's1',
  session_status: 'connected',
  phone: '5511999999999',
  enable_auto_assignment: 1,
  lock_to_single_conversation: 1,
  ignore_groups: 1,
  agent_bot_enabled: 0,
};
export const team: Team = {
  id: 5,
  name: 'Financeiro',
  description: null,
  allow_auto_assign: 1,
  member_count: 1,
};
export const labels: Label[] = [
  { id: 1, title: 'vip', description: 'Clientes VIP', color: '#ff0000' },
  { id: 2, title: 'financeiro', description: null, color: '#00aa00' },
];
const now = Math.floor(Date.now() / 1000);
export const conversation: Conversation = {
  id: 100,
  display_id: 7,
  inbox_id: 10,
  inbox_name: 'Suporte',
  contact_id: 50,
  contact_name: 'João Cliente',
  contact_phone: '+5511988887777',
  contact_jid: '5511988887777@s.whatsapp.net',
  status: 'open',
  assignee_id: null,
  assignee_name: null,
  team_id: null,
  team_name: null,
  labels: ['vip'],
  last_message: 'Preciso de ajuda',
  last_activity_at: now,
  unread_count: 2,
  snoozed_until: null,
  agent_bot_enabled: 0,
};
export const message = (id: number, fields: Partial<Message> = {}): Message => ({
  id,
  conversation_id: 100,
  message_type: 'incoming',
  content: `mensagem ${id}`,
  content_type: 'text',
  private: false,
  status: 'sent',
  sender_type: 'contact',
  sender_name: 'João Cliente',
  content_attributes: {},
  created_at: now,
  ...fields,
});

/** Default API for a logged-in workspace; tests override individual routes. */
export function workspaceRoutes(user: User = admin): Record<string, Route> {
  return {
    'GET /auth/me': { user, csrf: 'csrf-token' },
    'GET /inboxes': [inbox],
    'GET /agents': [admin, maria],
    'GET /teams': [team],
    'GET /labels': labels,
    'GET /notifications/unread_count': { unread: 3 },
    'GET /conversations': [conversation],
    'GET /conversations/meta': { mine: 1, unassigned: 4, all: 9 },
    'GET /conversations/7': conversation,
    'GET /conversations/7/messages': [message(1), message(2, { content: 'Alguém aí?' })],
    'POST /conversations/7/update_last_seen': { ...conversation, unread_count: 0 },
  };
}
