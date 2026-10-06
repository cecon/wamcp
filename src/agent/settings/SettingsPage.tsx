import { useState } from 'react';
import type { Catalog, User } from '../types';
import { AgentsSettings } from './AgentsSettings';
import { InboxesSettings } from './InboxesSettings';
import { TeamsSettings } from './TeamsSettings';
import { LabelsSettings, CannedSettings } from './CatalogSettings';
import { WebhooksSettings } from './WebhooksSettings';
import { AutomationsSettings } from './AutomationsSettings';

const TABS = [
  ['agents', 'Agentes'],
  ['inboxes', 'Caixas de entrada'],
  ['teams', 'Times'],
  ['labels', 'Etiquetas'],
  ['canned', 'Respostas prontas'],
  ['automations', 'Automações'],
  ['webhooks', 'Webhooks'],
] as const;
type Tab = (typeof TABS)[number][0];

export interface SettingsProps {
  user: User;
  catalog: Catalog;
  onChange: () => Promise<void>;
}

export function SettingsPage(props: SettingsProps) {
  const [tab, setTab] = useState<Tab>('agents');
  return (
    <div className="settings-page">
      <header>
        <h1>Configurações</h1>
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="settings-body">
        {tab === 'agents' && <AgentsSettings {...props} />}
        {tab === 'inboxes' && <InboxesSettings {...props} />}
        {tab === 'teams' && <TeamsSettings {...props} />}
        {tab === 'labels' && <LabelsSettings {...props} />}
        {tab === 'canned' && <CannedSettings />}
        {tab === 'automations' && <AutomationsSettings {...props} />}
        {tab === 'webhooks' && <WebhooksSettings {...props} />}
      </div>
    </div>
  );
}
