import type { Catalog, User } from '../types';
import type { Route } from '../route';
import { AgentsPage } from './AgentsPage';
import { TeamsPage } from './TeamsPage';
import { InboxesPage } from './InboxesPage';
import { LabelsPage } from './LabelsPage';
import { AttributesPage } from './AttributesPage';
import { CannedPage } from './CannedPage';
import { AutomationPage } from './AutomationPage';
import { WebhooksPage } from './WebhooksPage';

interface Props {
  route: Extract<Route, { page: 'settings' }>;
  user: User;
  catalog: Catalog;
  onNavigate: (route: Route) => void;
  onChange: () => Promise<void>;
}

/** Settings live in the main sidebar (Chatwoot has no separate settings menu); this picks the page. */
export function SettingsRouter({ route, user, catalog, onNavigate, onChange }: Props) {
  switch (route.section) {
    case 'agents':
      return <AgentsPage user={user} catalog={catalog} onChange={onChange} />;
    case 'teams':
      return <TeamsPage catalog={catalog} teamId={route.id} onNavigate={onNavigate} onChange={onChange} />;
    case 'inboxes':
      return <InboxesPage catalog={catalog} inboxId={route.id} onNavigate={onNavigate} onChange={onChange} />;
    case 'labels':
      return <LabelsPage catalog={catalog} onChange={onChange} />;
    case 'attributes':
      return <AttributesPage />;
    case 'canned':
      return <CannedPage />;
    case 'automation':
      return <AutomationPage catalog={catalog} />;
    case 'webhooks':
      return <WebhooksPage catalog={catalog} />;
  }
}
