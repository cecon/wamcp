import { lazy, Suspense, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { Catalog, User } from '../types';
import type { Route } from '../route';

// Telas migradas para o C3Theme: o chunk do MUI só carrega quando a seção abre.
const LabelsPage = lazy(() => import('./LabelsPage').then((module) => ({ default: module.LabelsPage })));
const CannedPage = lazy(() => import('./CannedPage').then((module) => ({ default: module.CannedPage })));
const MacrosPage = lazy(() => import('./MacrosPage').then((module) => ({ default: module.MacrosPage })));
const AttributesPage = lazy(() =>
  import('./AttributesPage').then((module) => ({ default: module.AttributesPage })),
);
const AccountPage = lazy(() => import('./AccountPage').then((module) => ({ default: module.AccountPage })));
const SlaPage = lazy(() => import('./SlaPage').then((module) => ({ default: module.SlaPage })));
const AuditLogPage = lazy(() =>
  import('./AuditLogPage').then((module) => ({ default: module.AuditLogPage })),
);
const InboxesPage = lazy(() => import('./InboxesPage').then((module) => ({ default: module.InboxesPage })));
const TeamsPage = lazy(() => import('./TeamsPage').then((module) => ({ default: module.TeamsPage })));
const WebhooksPage = lazy(() =>
  import('./WebhooksPage').then((module) => ({ default: module.WebhooksPage })),
);
const AutomationPage = lazy(() =>
  import('./AutomationPage').then((module) => ({ default: module.AutomationPage })),
);
const CustomRolesPage = lazy(() =>
  import('./roles/CustomRolesPage').then((module) => ({ default: module.CustomRolesPage })),
);
const ConnectionsPage = lazy(() =>
  import('./connections/ConnectionsPage').then((module) => ({ default: module.ConnectionsPage })),
);
const EnginePage = lazy(() =>
  import('./engine/EnginePage').then((module) => ({ default: module.EnginePage })),
);
const SchedulesPage = lazy(() =>
  import('./schedules/SchedulesPage').then((module) => ({ default: module.SchedulesPage })),
);
const AppSettingsPage = lazy(() =>
  import('./app/AppSettingsPage').then((module) => ({ default: module.AppSettingsPage })),
);
const AgentsPage = lazy(() => import('./AgentsPage').then((module) => ({ default: module.AgentsPage })));
const SkillsPage = lazy(() =>
  import('./directory/SkillsPage').then((module) => ({ default: module.SkillsPage })),
);
const OrganizationPage = lazy(() =>
  import('./members/OrganizationPage').then((module) => ({ default: module.OrganizationPage })),
);

/** Carrega a seção migrada mantendo o resto da página montado. */
function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Carregando…
          </Typography>
        </Box>
      }
    >
      {children}
    </Suspense>
  );
}
const PluginsPage = lazy(() =>
  import('./plugins/PluginsPage').then((module) => ({ default: module.PluginsPage })),
);

const StorePage = lazy(() => import('./store/StorePage').then((module) => ({ default: module.StorePage })));

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
    case 'account':
      return (
        <LazyPage>
          <AccountPage />
        </LazyPage>
      );
    case 'agents':
      return (
        <LazyPage>
          <AgentsPage user={user} catalog={catalog} onChange={onChange} />
        </LazyPage>
      );
    case 'organization':
      return (
        <LazyPage>
          <OrganizationPage catalog={catalog} />
        </LazyPage>
      );
    case 'teams':
      return (
        <LazyPage>
          <TeamsPage catalog={catalog} teamId={route.id} onNavigate={onNavigate} onChange={onChange} />
        </LazyPage>
      );
    case 'inboxes':
      return (
        <LazyPage>
          <InboxesPage catalog={catalog} inboxId={route.id} onNavigate={onNavigate} onChange={onChange} />
        </LazyPage>
      );
    case 'labels':
      return (
        <LazyPage>
          <LabelsPage catalog={catalog} onChange={onChange} />
        </LazyPage>
      );
    case 'attributes':
      return (
        <LazyPage>
          <AttributesPage />
        </LazyPage>
      );
    case 'canned':
      return (
        <LazyPage>
          <CannedPage />
        </LazyPage>
      );
    case 'automation':
      return (
        <LazyPage>
          <AutomationPage catalog={catalog} />
        </LazyPage>
      );
    case 'plugins':
      return (
        <LazyPage>
          <PluginsPage />
        </LazyPage>
      );
    case 'store':
      return (
        <LazyPage>
          <StorePage />
        </LazyPage>
      );
    case 'skills':
      return (
        <LazyPage>
          <SkillsPage />
        </LazyPage>
      );
    case 'macros':
      return (
        <LazyPage>
          <MacrosPage user={user} catalog={catalog} />
        </LazyPage>
      );
    case 'sla':
      return (
        <LazyPage>
          <SlaPage />
        </LazyPage>
      );
    case 'webhooks':
      return (
        <LazyPage>
          <WebhooksPage catalog={catalog} />
        </LazyPage>
      );
    case 'audit':
      return (
        <LazyPage>
          <AuditLogPage />
        </LazyPage>
      );
    case 'custom_roles':
      return (
        <LazyPage>
          <CustomRolesPage onChange={onChange} />
        </LazyPage>
      );
    case 'connections':
      // WhatsApp connections are listed with the other channels; this page is one connection.
      return route.connectionId ? (
        <LazyPage>
          <ConnectionsPage connectionId={route.connectionId} onNavigate={onNavigate} onChange={onChange} />
        </LazyPage>
      ) : (
        <LazyPage>
          <InboxesPage catalog={catalog} onNavigate={onNavigate} onChange={onChange} />
        </LazyPage>
      );
    case 'engine':
      return (
        <LazyPage>
          <EnginePage />
        </LazyPage>
      );
    case 'schedules':
      return (
        <LazyPage>
          <SchedulesPage />
        </LazyPage>
      );
    case 'app':
      return (
        <LazyPage>
          <AppSettingsPage />
        </LazyPage>
      );
  }
}
