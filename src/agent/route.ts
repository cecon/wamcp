import type { ConversationType, FilterCondition } from './types';

/** In-app navigation state (the agent UI is a single page served at /app/). */
export type SettingsSection =
  | 'account'
  | 'agents'
  | 'organization'
  | 'teams'
  | 'inboxes'
  | 'labels'
  | 'attributes'
  | 'canned'
  | 'automation'
  | 'skills'
  | 'macros'
  | 'sla'
  | 'webhooks'
  | 'audit'
  | 'custom_roles'
  | 'engine'
  | 'connections'
  | 'app';

/** Settings pages every agent can open (the others are for administrators). */
export const AGENT_SECTIONS: SettingsSection[] = ['macros'];

/** Chatwoot report pages (administrators and roles with `report_manage`). */
export type ReportSection = 'overview' | 'agents' | 'inboxes' | 'teams' | 'labels' | 'csat' | 'bots' | 'sla';

export type Route =
  | { page: 'notifications' }
  | {
      page: 'conversations';
      inboxId?: number;
      teamId?: number;
      label?: string;
      q?: string;
      displayId?: number;
      conversationType?: ConversationType;
      /** Saved view (Chatwoot folder) whose filters are in `filters`. */
      viewId?: number;
      /** Advanced filter payload; when set the list comes from POST /conversations/filter. */
      filters?: FilterCondition[];
    }
  | { page: 'contacts'; contactId?: number }
  /** Private chats with AI agents inside the app. */
  | { page: 'agent_chat'; agentId?: number }
  | { page: 'reports'; section?: ReportSection }
  | { page: 'search' }
  | { page: 'profile' }
  | { page: 'settings'; section: SettingsSection; id?: number; connectionId?: string };

export const HOME: Route = { page: 'conversations' };
