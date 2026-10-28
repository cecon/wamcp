import type { Catalog, User } from '../types';
import { SettingsPage } from '../ui/Settings';
import { RosterSection } from './directory/RosterSection';

interface Props {
  user: User;
  catalog: Catalog;
  onChange: () => Promise<void>;
}

/** "Funcionários": one list of people and AI agents, each with a mandatory profile that sets its role. */
export function AgentsPage({ user, catalog, onChange }: Props) {
  return (
    <SettingsPage wide>
      <RosterSection user={user} catalog={catalog} onChange={onChange} />
    </SettingsPage>
  );
}
