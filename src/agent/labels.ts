import type { ConversationStatus } from './types';

export const STATUS_LABEL: Record<ConversationStatus | 'all', string> = {
  open: 'Abertas',
  pending: 'Pendentes (IA)',
  snoozed: 'Adiadas',
  resolved: 'Resolvidas',
  all: 'Todos os status',
};
