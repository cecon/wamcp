import { ApiError } from '../api';
import type { User } from '../types';

export type Me = { user: User; csrf: string | null };
/** POST /auth/login: a session, or a two-factor challenge to complete with POST /auth/mfa. */
export type LoginResult = Me | { mfa_required: true; mfa_token: string };

/** Rate limited logins answer 429 with a plain-text body. */
export const authError = (error: unknown) =>
  error instanceof ApiError && error.status === 429
    ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
    : (error as Error).message;
