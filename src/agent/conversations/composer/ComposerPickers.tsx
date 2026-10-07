import { Search, Smile } from 'lucide-react';
import type { Canned } from '../../types';
import { cn } from '../../ui/cn';
import { Dropdown } from '../../ui/Overlay';

// prettier-ignore
const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😉', '😎', '🤔', '😐', '😅',
  '😢', '😭', '😡', '😮', '😴', '🤗', '🙄', '😬', '👍', '👎', '👏', '🙏',
  '🙌', '👋', '💪', '🤝', '👀', '✅', '❌', '⚠️', '❤️', '💙', '🎉', '🔥',
  '⭐', '💡', '📌', '📞', '📦', '💰', '🕒', '🚀',
];

/** Compact emoji grid; the composer inserts the pick at the caret. */
export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  return (
    <Dropdown
      align="start"
      placement="top"
      className="w-72 grid-cols-8"
      trigger={({ toggle }) => (
        <button
          type="button"
          aria-label="Inserir emoji"
          title="Emoji"
          disabled={disabled}
          onClick={toggle}
          className="grid size-8 place-content-center rounded-lg text-n-slate-11 hover:bg-n-alpha-2 disabled:opacity-50"
        >
          <Smile size={16} />
        </button>
      )}
    >
      {(close) =>
        EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="menuitem"
            aria-label={emoji}
            onClick={() => {
              onPick(emoji);
              close();
            }}
            className="grid size-8 place-content-center rounded-lg text-lg hover:bg-n-alpha-2"
          >
            {emoji}
          </button>
        ))
      }
    </Dropdown>
  );
}

interface CannedProps {
  shortcut: string;
  options: Canned[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (canned: Canned) => void;
}

/** Chatwoot CannedResponse.vue: list on the left, preview of the highlighted one on the right. */
export function CannedList({ shortcut, options, highlight, onHighlight, onPick }: CannedProps) {
  const preview = options[highlight];
  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 flex h-60 w-full max-w-[768px] overflow-hidden rounded-xl border border-n-strong bg-n-alpha-3 shadow-lg backdrop-blur-[100px]">
      <div className="flex w-full max-w-[420px] flex-col border-r border-n-weak">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-n-weak px-3 text-sm text-n-slate-11">
          <Search size={14} /> Respostas prontas: /{shortcut}
        </div>
        <ul role="listbox" aria-label="Respostas prontas" className="overflow-y-auto p-1">
          {options.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => onHighlight(i)}
                onClick={() => onPick(c)}
                className={cn(
                  'w-full rounded-lg px-2 py-1 text-left',
                  i === highlight && 'bg-n-alpha-black2',
                )}
              >
                <span className="block text-sm font-medium text-n-slate-12">/{c.short_code}</span>
                <span className="block truncate text-xs text-n-slate-11">{c.content}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {preview && (
        <p className="hidden flex-1 overflow-y-auto px-4 py-3 text-sm whitespace-pre-wrap text-n-slate-12 md:block">
          {preview.content}
        </p>
      )}
    </div>
  );
}
