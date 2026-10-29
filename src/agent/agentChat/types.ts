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

export const chatTime = (ms: number) => {
  const date = new Date(ms);
  return new Date().toDateString() === date.toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
