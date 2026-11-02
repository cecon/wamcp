import { lazy, Suspense, type ReactNode } from 'react';

import type { Catalog, User } from '../types';
import type { Route } from '../route';
import { AgentsPage } from './AgentsPage';
import { AutomationPage } from './AutomationPage';
import { SkillsPage } from './directory/SkillsPage';
import { OrganizationPage } from './members/OrganizationPage';
import { CustomRolesPage } from './roles/CustomRolesPage';
import { ConnectionsPage } from './connections/ConnectionsPage';
import { AppSettingsPage } from './app/AppSettingsPage';
import { EnginePage } from './engine/EnginePage';
import { SchedulesPage } from './schedules/SchedulesPage';

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

/** Carrega a seção migrada mantendo o resto da página montado. */
function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-n-slate-11">Carregando…</div>}>{children}</Suspense>
  );
}

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
      return <AgentsPage user={user} catalog={catalog} onChange={onChange} />;
    case 'organization':
      return <OrganizationPage catalog={catalog} />;
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
      return <AutomationPage catalog={catalog} />;
    case 'skills':
      return <SkillsPage />;
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
      return <CustomRolesPage onChange={onChange} />;
    case 'connections':
      // WhatsApp connections are listed with the other channels; this page is one connection.
      return route.connectionId ? (
        <ConnectionsPage connectionId={route.connectionId} onNavigate={onNavigate} onChange={onChange} />
      ) : (
        <LazyPage>
          <InboxesPage catalog={catalog} onNavigate={onNavigate} onChange={onChange} />
        </LazyPage>
      );
    case 'engine':
      return <EnginePage />;
    case 'schedules':
      return <SchedulesPage />;
    case 'app':
      return <AppSettingsPage />;
  }
}
