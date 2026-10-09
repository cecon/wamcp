/** WhatsApp connections (sessions) managed by administrators under /api/v1/sessions. */
export interface Connection {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  created?: string;
  message_count?: number;
}

/** GET /sessions/{id}: the session plus its pairing detail and MCP address. */
export interface ConnectionDetail extends Connection {
  /** QR Code while pairing: an image data URL (SVG) from the backend, or the raw QR text. */
  qr?: string | null;
  error?: string | null;
  mcpUrl?: string;
}

export interface HistoryChat {
  jid: string;
  name: string | null;
  preview: string | null;
  updated: number;
}

export interface HistoryMessage {
  id: string;
  jid: string;
  body: string;
  kind?: string;
  sender: string | null;
  from_me: number;
  ts: number;
}

export interface McpToken {
  id: string;
  name: string;
  scope: string;
  created?: string;
  expires: string;
  last_used?: string | null;
  /** Only in the POST response: shown once. */
  token?: string;
}

export interface AuditEntry {
  action: string;
  at: string;
  token_id: string | null;
}

export interface ChatGptGrant {
  id: string;
  name: string;
  scope: string;
  expires: string;
}

export interface ChatGptLinkCode {
  code: string;
  expires: string;
}

export const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;

const STATUS: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  connecting: 'Conectando',
  qr: 'Aguardando QR Code',
  reconnecting: 'Reconectando',
  logged_out: 'Conecte novamente',
  error: 'Erro de conexão',
};
export const statusLabel = (status: string) => STATUS[status] || status;

/** Pairing or reconnecting: the detail page polls until the phone is connected. */
export const ACTIVE = ['connected', 'qr', 'connecting', 'reconnecting'];

export const SCOPES = [
  { value: 'read', label: 'Somente leitura' },
  { value: 'read_write', label: 'Leitura e envio' },
];
export const scopeLabel = (scope: string) => SCOPES.find((s) => s.value === scope)?.label || scope;

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
export const formatPhone = (phone: string | null) => (phone ? `+${phone}` : 'Nenhum número conectado');
