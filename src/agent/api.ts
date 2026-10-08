let csrfToken = '';
export function setCsrf(token: string | null) {
  csrfToken = token || '';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** A 403: the agent's role does not allow the resource. */
export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

/** Same-origin call to /api/v1 with the session cookie; state-changing requests carry the CSRF token. */
export function http<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return request<T>(`/api/v1${path}`, method, body);
}

/** First-run setup under /api/helpdesk: whether an administrator exists, and creating it. */
export function firstRun<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return request<T>(`/api/helpdesk${path}`, method, body);
}

async function request<T>(url: string, method: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(data?.error || 'Não foi possível concluir a operação.', response.status);
  return data as T;
}

/** Multipart POST: the browser sets the boundary, so no JSON content-type here. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
    body: form,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || 'Não foi possível enviar o arquivo.', response.status);
  return data as T;
}

/** Downloads a file served by the API (transcripts, CSV exports) through a temporary link. */
export async function download(path: string, filename: string) {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error || 'Não foi possível baixar o arquivo.', response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const query = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

const EVENTS = [
  'conversation.created',
  'conversation.updated',
  'conversation.status_changed',
  'conversation.bot_handoff',
  'assignee.changed',
  'team.changed',
  'message.created',
  'message.updated',
  'notification.created',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'presence.update',
  'conversation.typing_on',
  'conversation.typing_off',
  'sla.missed',
];

export interface RealtimeEvent {
  event: string;
  data: Record<string, unknown>;
}
export type Realtime = { subscribe(listener: (e: RealtimeEvent) => void): () => void; close(): void };

/** One EventSource per tab, fanned out to components. The browser reconnects automatically. */
export function connectRealtime(onStatus: (online: boolean) => void): Realtime {
  const listeners = new Set<(e: RealtimeEvent) => void>();
  const source = new EventSource('/api/v1/events');
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  for (const name of EVENTS)
    source.addEventListener(name, (message) => {
      const payload = JSON.parse((message as MessageEvent).data);
      for (const listener of listeners) listener({ event: name, data: payload.data });
    });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => source.close(),
  };
}

export const formatTime = (ts: number) => {
  const date = new Date(ts * 1000);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const initials = (name: string | null | undefined) =>
  (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';

/** Seconds → "45s", "12min", "3h 20min". */
export function duration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  const minutes = Math.round((s % 3600) / 60);
  return `${Math.floor(s / 3600)}h${minutes ? ` ${minutes}min` : ''}`;
}

/** Bytes → "820 B", "12 KB", "1,5 MB". */
export function humanSize(bytes: number | null | undefined) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

/** Chatwoot-style short relative time: "agora", "5m", "3h", "2d", then the date. */
export function timeAgo(ts: number, now = Date.now() / 1000) {
  const diff = Math.max(0, now - ts);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
