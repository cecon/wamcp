import { UtensilsCrossed } from 'lucide-react';
import type { CatalogSection, Route } from '../route';
import { SidebarGroup, SidebarLeaf } from './SidebarParts';

const SECTIONS: { section: CatalogSection; label: string; admin?: boolean }[] = [
  { section: 'menu', label: 'Cardápio' },
  { section: 'groups', label: 'Complementos' },
  { section: 'import', label: 'Importar do iFood', admin: true },
  { section: 'settings', label: 'Configurações do cardápio', admin: true },
];

interface Props {
  route: Route;
  isAdmin: boolean;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (route: Route) => void;
}

/** "Catálogo" sidebar group: every agent sees the menu; import and settings only administrators. */
export function CatalogNav({ route, isAdmin, expanded, onToggle, onNavigate }: Props) {
  const current = route.page === 'catalog' ? route.section || 'menu' : null;
  return (
    <SidebarGroup
      icon={UtensilsCrossed}
      label="Catálogo"
      active={false}
      parentOfActive={current !== null}
      expanded={expanded}
      onClick={onToggle}
    >
      {SECTIONS.filter((s) => isAdmin || !s.admin).map(({ section, label }) => (
        <SidebarLeaf
          key={section}
          label={label}
          active={current === section}
          onClick={() => onNavigate({ page: 'catalog', section })}
        />
      ))}
    </SidebarGroup>
  );
}
