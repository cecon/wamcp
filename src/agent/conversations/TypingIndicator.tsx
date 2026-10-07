import { useEffect, useRef, useState } from 'react';
import type { Realtime } from '../api';

interface TypingEvent {
  display_id?: number;
  recording?: boolean;
  user?: { type?: string; id?: number; name?: string | null };
}
interface Props {
  realtime: Realtime;
  displayId: number;
  currentUserId: number;
}

/** Chatwoot TypingIndicator: "<name> está digitando…" for the open conversation, gone after 10 s. */
export function TypingIndicator({ realtime, displayId, currentUserId }: Props) {
  const [typing, setTyping] = useState<{ name: string; recording: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = realtime.subscribe(({ event, data }) => {
      if (!event.startsWith('conversation.typing_')) return;
      const e = data as TypingEvent;
      if (e.display_id !== displayId) return;
      if (e.user?.type === 'user' && e.user.id === currentUserId) return;
      clearTimeout(timer.current);
      if (event === 'conversation.typing_off') return setTyping(null);
      setTyping({ name: e.user?.name || 'Contato', recording: Boolean(e.recording) });
      timer.current = setTimeout(() => setTyping(null), 10_000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, [realtime, displayId, currentUserId]);
  if (!typing) return null;
  return (
    <p role="status" className="flex items-center gap-2 px-4 pb-1 text-xs text-n-slate-11">
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-n-slate-9"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      {typing.name} {typing.recording ? 'está gravando áudio…' : 'está digitando…'}
    </p>
  );
}
