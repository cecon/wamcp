import type { CustomRole } from '../../adminTypes';
import { useFetch } from '../../useFetch';

/** Custom roles of the account (administrators). */
export function useCustomRoles() {
  const { data, error, reload } = useFetch<CustomRole[]>('/custom_roles');
  return { roles: data || [], error, reload };
}
