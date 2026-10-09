import type { Realtime } from '../api';
import { canEditCatalog } from '../permissions';
import type { CatalogSection, Route } from '../route';
import type { User } from '../types';
import { CatalogSettingsPage } from './CatalogSettingsPage';
import { GroupsPage } from './groups/GroupsPage';
import { ImportPage } from './importer/ImportPage';
import { MenuPage } from './menu/MenuPage';

interface Props {
  user: User;
  section?: CatalogSection;
  realtime?: Realtime;
  onNavigate: (route: Route) => void;
}

/** Catálogo: menu, complements library, iFood import and settings (the last two for administrators). */
export function CatalogScreen({ user, section = 'menu', realtime, onNavigate }: Props) {
  const editable = canEditCatalog(user);
  if (section === 'groups') return <GroupsPage editable={editable} realtime={realtime} />;
  if (section === 'import')
    return (
      <ImportPage realtime={realtime} onOpenMenu={() => onNavigate({ page: 'catalog', section: 'menu' })} />
    );
  if (section === 'settings') return <CatalogSettingsPage />;
  return <MenuPage editable={editable} realtime={realtime} />;
}
