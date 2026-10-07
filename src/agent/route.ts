import type { ConversationType, FilterCondition } from './types';

/** In-app navigation state (the agent UI is a single page served at /app/). */
export type SettingsSection =
  'agents' | 'teams' | 'inboxes' | 'labels' | 'attributes' | 'canned' | 'automation' | 'webhooks';

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
  | { page: 'settings'; section: SettingsSection; id?: number };

export const HOME: Route = { page: 'conversations' };
