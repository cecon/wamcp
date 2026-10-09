import { useState } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { SettingsRouter } from '../../src/agent/settings/SettingsRouter';
import type { Route } from '../../src/agent/route';
import type { ConnectionDetail } from '../../src/agent/settings/connections/model';
import { admin, inbox, labels, maria, team } from './fixtures';

const catalog = { inboxes: [inbox], agents: [admin, maria], teams: [team], labels };

export const connected: ConnectionDetail = {
  id: 's1',
  name: 'Suporte',
  phone: '5511999999999',
  status: 'connected',
  qr: null,
  error: null,
  mcpUrl: 'https://wamcp.example.com/mcp/s1',
};

function Harness({ initial, onChange }: { initial: Route; onChange: () => Promise<void> }) {
  const [route, setRoute] = useState<Route>(initial);
  if (route.page !== 'settings') return null;
  return (
    <SettingsRouter route={route} user={admin} catalog={catalog} onNavigate={setRoute} onChange={onChange} />
  );
}

/** Settings → Conexões WhatsApp with working in-app navigation. */
export function renderConnections(
  connectionId?: string,
  options: Parameters<typeof userEvent.setup>[0] = {},
) {
  const onChange = vi.fn(async () => {});
  render(
    <Harness initial={{ page: 'settings', section: 'connections', connectionId }} onChange={onChange} />,
  );
  return { onChange, user: userEvent.setup(options) };
}
