import { useEffect, useMemo, useRef, useState } from 'react';
import { http } from '../api';
import type { Message } from '../types';
import type { MessageHandlers } from './MessageActions';
import { MessageItem } from './MessageItem';

interface Props {
  messages: Message[];
  path: string;
  currentUserId: number;
  onUpsert: (message: Message) => void;
  onReply: (message: Message) => void;
  onError: (message: string) => void;
}

const isMessage = (value: unknown): value is Message =>
  typeof value === 'object' && value !== null && 'id' in value && 'content_attributes' in value;

/** Chatwoot MessageList: bubbles plus their actions (reply, react, delete, retry, jump to quote). */
export function MessageList({ messages, path, currentUserId, onUpsert, onReply, onError }: Props) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const handlers = useMemo<MessageHandlers>(() => {
    const run = (request: Promise<unknown>) =>
      void request
        .then((result) => isMessage(result) && onUpsert(result))
        .catch((e: Error) => onError(e.message));
    return {
      onReply,
      onReact: (m, emoji) => run(http(`${path}/messages/${m.id}/reactions`, 'POST', { emoji })),
      onDelete: (m) => run(http(`${path}/messages/${m.id}`, 'DELETE')),
      onRetry: (m) => run(http(`${path}/messages/${m.id}/retry`, 'POST')),
      onJump: (id) => {
        document.getElementById(`message${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlight(id);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setHighlight(null), 2000);
      },
    };
  }, [path, onUpsert, onReply, onError]);

  return (
    <ul className="px-4">
      {messages.map((m) => {
        const replyTo = m.content_attributes.in_reply_to;
        return (
          <MessageItem
            key={m.id}
            message={m}
            quoted={replyTo ? byId.get(replyTo) : undefined}
            handlers={handlers}
            currentUserId={currentUserId}
            highlighted={highlight === m.id}
          />
        );
      })}
    </ul>
  );
}
