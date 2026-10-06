/** Pure helpdesk rules (Chatwoot-style): roles, visibility, conversation lifecycle and round robin. */
export const ROLES = ['administrator', 'agent'];
export const STATUSES = ['open', 'pending', 'resolved', 'snoozed'];
export const AVAILABILITY = ['online', 'busy', 'offline'];

export class HelpdeskError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const isAdmin = (user) => user?.role === 'administrator';

export function requireAdmin(user) {
  if (!isAdmin(user)) throw new HelpdeskError('Somente administradores podem fazer isso', 403);
}

/** Admins see every inbox; agents only the inboxes they are members of. */
export function canAccessInbox(user, memberInboxIds, inboxId) {
  return isAdmin(user) || memberInboxIds.includes(inboxId);
}

export function requireInboxAccess(user, memberInboxIds, inboxId) {
  if (!canAccessInbox(user, memberInboxIds, inboxId)) throw new HelpdeskError('Conversa não encontrada', 404);
}

/** WhatsApp groups, broadcasts and channels never become support conversations. */
export function isSupportJid(jid, { ignoreGroups = true } = {}) {
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast'))
    return false;
  return !(ignoreGroups && jid.endsWith('@g.us'));
}

export function phoneFromJid(jid) {
  const match = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid || '');
  return match ? `+${match[1]}` : null;
}

/**
 * Decides where an incoming contact message lands.
 * Unresolved conversations are reused (snoozed ones wake up); a resolved one is reopened only when the
 * inbox locks each contact to a single conversation, otherwise a new conversation starts.
 */
export function routeIncoming(latest, inbox) {
  if (latest && latest.status !== 'resolved') return { action: 'reuse', reopen: latest.status === 'snoozed' };
  if (latest && inbox.lock_to_single_conversation) return { action: 'reuse', reopen: true };
  return { action: 'create' };
}

/** Messages typed on the phone only join a conversation that is still being handled. */
export function routeOwnMessage(latest) {
  return latest && latest.status !== 'resolved' ? { action: 'reuse' } : { action: 'ignore' };
}

/** Bots handle new conversations in `pending` until they hand off to a human. */
export const initialStatus = ({ hasBot }) => (hasBot ? 'pending' : 'open');

export function validateStatusChange(status, snoozedUntil, now) {
  if (!STATUSES.includes(status)) throw new HelpdeskError('Status inválido');
  if (status === 'snoozed' && snoozedUntil != null && snoozedUntil <= now)
    throw new HelpdeskError('O adiamento precisa ser no futuro');
}

/** Round robin over eligible agents ordered by id, continuing after the last assignee. */
export function nextAssignee(candidateIds, lastUserId) {
  if (!candidateIds.length) return null;
  const sorted = [...candidateIds].sort((a, b) => a - b);
  return sorted.find((id) => id > (lastUserId ?? 0)) ?? sorted[0];
}

const STATUS_LABEL = {
  open: 'reabriu a conversa',
  pending: 'marcou a conversa como pendente',
  resolved: 'resolveu a conversa',
  snoozed: 'adiou a conversa',
};

export const statusActivity = (actor, status) => `${actor || 'Sistema'} ${STATUS_LABEL[status]}`;

export function assignmentActivity(actor, assignee) {
  if (!assignee) return `${actor || 'Sistema'} removeu o responsável`;
  if (actor && actor === assignee) return `${actor} assumiu a conversa`;
  return `${actor || 'Sistema'} atribuiu a conversa a ${assignee}`;
}

export const teamActivity = (actor, team) =>
  team ? `${actor || 'Sistema'} atribuiu a conversa ao time ${team}` : `${actor || 'Sistema'} removeu o time`;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200)
    throw new HelpdeskError('A senha precisa ter entre 10 e 200 caracteres');
}
