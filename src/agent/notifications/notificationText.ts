import type { NotificationType } from '../accountTypes';
import type { AppNotification } from '../types';

/** Notification types with the label used by the profile preferences (Chatwoot order). */
export const NOTIFICATION_TYPES: [NotificationType, string][] = [
  ['conversation_creation', 'Uma nova conversa foi criada'],
  ['conversation_assignment', 'Uma conversa foi atribuída a você'],
  ['conversation_mention', 'Você foi mencionado em uma conversa'],
  ['assigned_conversation_new_message', 'Uma nova mensagem foi criada e atribuída'],
  [
    'participating_conversation_new_message',
    'Uma nova mensagem foi criada em uma conversa que você participa',
  ],
  ['sla_missed', 'O SLA de uma conversa atribuída a você foi perdido'],
];

const TEXT: Record<string, (n: AppNotification) => string> = {
  conversation_assignment: (n) => `${n.actor_name || 'Sistema'} atribuiu a você a conversa #${n.display_id}`,
  assigned_conversation_new_message: (n) => `Nova mensagem em #${n.display_id}`,
  conversation_creation: (n) => `Nova conversa #${n.display_id}`,
  conversation_mention: (n) => `${n.actor_name || 'Alguém'} mencionou você na conversa #${n.display_id}`,
  participating_conversation_new_message: (n) =>
    `Nova mensagem na conversa #${n.display_id} em que você participa`,
  sla_missed: (n) => `SLA perdido na conversa #${n.display_id}`,
};

/** pt-BR sentence for a notification; unknown types show their raw name. */
export const notificationText = (n: AppNotification) => TEXT[n.notification_type]?.(n) ?? n.notification_type;

/** Snooze choices (Chatwoot): one hour, tomorrow at 9:00 and next Monday at 9:00, in epoch seconds. */
export const SNOOZE_OPTIONS: { label: string; until: (now: Date) => number }[] = [
  { label: 'Adiar por 1 hora', until: (now) => Math.floor(now.getTime() / 1000) + 3600 },
  { label: 'Adiar até amanhã às 9h', until: (now) => at9(now, 1) },
  { label: 'Adiar até a próxima semana', until: (now) => at9(now, (8 - now.getDay()) % 7 || 7) },
];

function at9(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}
