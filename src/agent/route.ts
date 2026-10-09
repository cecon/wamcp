/** In-app navigation state (the agent UI is a single page served at /app/). */
export type SettingsSection =
  'agents' | 'teams' | 'inboxes' | 'labels' | 'canned' | 'automation' | 'webhooks';

export type Route =
  | { page: 'notifications' }
  | {
      page: 'conversations';
      inboxId?: number;
      teamId?: number;
      label?: string;
      q?: string;
      displayId?: number;
    }
  | { page: 'contacts' }
  | { page: 'reports' }
  | { page: 'settings'; section: SettingsSection; id?: number };

export const HOME: Route = { page: 'conversations' };
