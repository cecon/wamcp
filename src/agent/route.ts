import type { ConversationType, FilterCondition } from './types';

/** In-app navigation state (the agent UI is a single page served at /app/). */
export type SettingsSection =
  | 'agents'
  | 'teams'
  | 'inboxes'
  | 'labels'
  | 'attributes'
  | 'canned'
  | 'automation'
  | 'macros'
  | 'webhooks'
  | 'audit';

/** Settings pages every agent can open (the others are for administrators). */
export const AGENT_SECTIONS: SettingsSection[] = ['macros'];

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
  | { page: 'contacts' }
  | { page: 'reports' }
  | { page: 'profile' }
  | { page: 'settings'; section: SettingsSection; id?: number };

export const HOME: Route = { page: 'conversations' };
