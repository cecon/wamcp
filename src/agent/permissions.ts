import type { Permission } from './adminTypes';
import type { User } from './types';
import { AGENT_SECTIONS, CATALOG_ADMIN_SECTIONS, type Route } from './route';

/** Custom role permissions with their pt-BR descriptions (Chatwoot order). */
export const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: 'conversation_manage', label: 'Gerenciar todas as conversas' },
  { key: 'conversation_unassigned_manage', label: 'Conversas sem responsável e as próprias' },
  { key: 'conversation_participating_manage', label: 'Conversas em que participa e as próprias' },
  { key: 'contact_manage', label: 'Gerenciar contatos' },
  { key: 'report_manage', label: 'Ver relatórios' },
];

export const permissionLabel = (key: string) => PERMISSIONS.find((p) => p.key === key)?.label || key;

const hasRole = (user: User) => user.custom_role_id != null;
const granted = (user: User, permission: Permission) => (user.permissions || []).includes(permission);

/** Contacts: administrators and agents without a role always; agents with a role need `contact_manage`. */
export function canManageContacts(user: User) {
  return user.role === 'administrator' || !hasRole(user) || granted(user, 'contact_manage');
}

/** Reports: administrators, or agents whose role grants `report_manage` (default agents have none). */
export function canViewReports(user: User) {
  return user.role === 'administrator' || (hasRole(user) && granted(user, 'report_manage'));
}

/** Catalog edits (categories, items, complements, import, settings) are for administrators. */
export const canEditCatalog = (user: User) => user.role === 'administrator';

/** Whether the agent may open the page (the sidebar hides the others; direct links show "no access"). */
export function canOpen(user: User, route: Route) {
  if (route.page === 'contacts') return canManageContacts(user);
  if (route.page === 'reports') return canViewReports(user);
  if (route.page === 'catalog')
    return canEditCatalog(user) || !CATALOG_ADMIN_SECTIONS.includes(route.section || 'menu');
  if (route.page === 'settings')
    return user.role === 'administrator' || AGENT_SECTIONS.includes(route.section);
  return true;
}
