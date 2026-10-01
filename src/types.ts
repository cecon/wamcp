export interface Session {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  message_count?: number;
  qr?: string | null;
  error?: string | null;
  mcpUrl?: string;
}
export interface Chat {
  jid: string;
  name: string | null;
  preview: string | null;
  updated: number;
}
export interface Message {
  id: string;
  jid: string;
  body: string;
  sender: string;
  from_me: number;
  ts: number;
}
export interface AccessToken {
  id: string;
  name: string;
  scope: string;
  expires: string;
  last_used: string | null;
  token?: string;
}
export interface Audit {
  action: string;
  at: string;
  token_id: string;
}
