import { RefreshCcw } from 'lucide-react';
import type { Message, Reaction } from '../types';
import { cn } from '../ui/cn';
import { authorOf, snippet } from './messageText';

/** Chatwoot bubbles/Base.vue in-reply-to preview: clicking scrolls to the quoted message. */
export function QuotedMessage({ message, onJump }: { message: Message; onJump?: (id: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`Ir para a mensagem citada de ${authorOf(message)}`}
      onClick={() => onJump?.(message.id)}
      className="-mx-1 mb-2 block w-[calc(100%+0.5rem)] rounded-lg border-l-4 border-n-brand bg-n-alpha-black1 p-2 text-left"
    >
      <span className="block text-xs font-medium text-n-blue-11">{authorOf(message)}</span>
      <span className="line-clamp-1 text-xs text-n-slate-11">{snippet(message)}</span>
    </button>
  );
}

/** Emoji chips under the bubble: count per emoji, names in the tooltip. */
export function Reactions({
  reactions,
  outgoing,
  mine,
}: {
  reactions: Reaction[];
  outgoing: boolean;
  mine?: (r: Reaction) => boolean;
}) {
  if (!reactions.length) return null;
  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) groups.set(r.emoji, [...(groups.get(r.emoji) || []), r]);
  return (
    <ul aria-label="Reações" className={cn('-mt-1 flex gap-1', outgoing ? 'justify-end' : 'justify-start')}>
      {[...groups].map(([emoji, list]) => (
        <li
          key={emoji}
          title={list.map((r) => r.sender_name || 'Contato').join(', ')}
          className={cn(
            'flex items-center gap-1 rounded-full border bg-n-solid-1 px-1.5 text-xs shadow-sm',
            list.some((r) => mine?.(r)) ? 'border-n-brand' : 'border-n-weak',
          )}
        >
          <span>{emoji}</span>
          {list.length > 1 && <span className="text-n-slate-11">{list.length}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Chatwoot MessageError.vue retry button (the reason stays in the status tooltip). */
export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-1 ml-auto flex h-5 items-center gap-1 rounded-md bg-n-alpha-2 px-1.5 text-xs text-n-ruby-11 hover:bg-n-alpha-1"
    >
      <RefreshCcw size={12} /> Reenviar
    </button>
  );
}
