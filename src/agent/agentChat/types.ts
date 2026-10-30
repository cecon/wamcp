import type { AvatarChoices } from '../adminTypes';

/** One message of a chat with an AI agent (`created_at` in milliseconds). */
export interface ChatMessage {
  id: number;
  chat_id: number;
  user_id: number;
  agent_id: number;
  /** The person (`user`), the agent's answer (`agent`) or why it could not answer (`error`). */
  role: 'user' | 'agent' | 'error';
  content: string;
  created_at: number;
  /** The chat session it belongs to (a new session starts from scratch for the agent). */
  session: number;
}

/** One session of the chat, with what the agent spent on it. */
export interface ChatSession {
  number: number;
  started_at: number;
  last_at: number;
  messages: number;
  /** The person's first message. */
  preview: string | null;
  tokens: number;
  cost_brl: number;
  /** Reached the token limit: takes no more messages. */
  full: boolean;
}

/** The chat's sessions, newest first, and which one is open. */
export interface ChatSessions {
  current: number;
  token_limit: number;
  sessions: ChatSession[];
}

/** A step of the agent while it works on the answer: a note it wrote or a tool it called. */
export interface ChatStep {
  kind: 'note' | 'tool';
  text: string;
}

/** An AI agent the person may talk to, with the newest message of their chat. */
export interface ChatAgent {
  id: number;
  name: string;
  description: string | null;
  role: string | null;
  profile_name: string | null;
  runtime: string | null;
  model: string | null;
  /** The app's own agent (administrators only): sets the app up, after approval. */
  system: boolean;
  avatar?: AvatarChoices;
  last: ChatMessage | null;
}

const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** "12,3 mil" tokens. */
export const tokens = (n: number) => COMPACT.format(n);
export const brl = (n: number) => BRL.format(n);

/** A Markdown message as one line of plain text (the chat list's preview). */
export const plainText = (markdown: string) =>
  markdown
    .replace(/`{3}[\s\S]*?(`{3}|$)/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.|\|?-{3,}.*)\s*/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const chatTime = (ms: number) => {
  const date = new Date(ms);
  return new Date().toDateString() === date.toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
