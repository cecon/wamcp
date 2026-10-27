import type { Role } from '../../types';

/** A new helpdesk login for a person: created before the person is saved. */
export interface NewAccess {
  enabled: boolean;
  email: string;
  password: string;
  role: Role;
}

export const noAccess = (): NewAccess => ({ enabled: false, email: '', password: '', role: 'agent' });
