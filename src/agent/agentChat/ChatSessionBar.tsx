import { History, SquarePen } from 'lucide-react';
import { Dropdown } from '../ui/Overlay';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { brl, chatTime, tokens, type ChatSessions } from './types';

interface Props {
  sessions: ChatSessions | null;
  /** The session on screen. */
  viewing: number;
  onView: (session: number) => void;
  onNew: () => void;
  busy: boolean;
}

/** The chat's header actions: what the open session spent, the earlier sessions and a new one. */
export function ChatSessionBar({ sessions, viewing, onView, onNew, busy }: Props) {
  const shown = sessions?.sessions.find((s) => s.number === viewing);
  const used = shown && sessions ? Math.min(1, shown.tokens / sessions.token_limit) : 0;
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {shown && sessions && (
        <div
          className="mr-2 hidden flex-col items-end gap-1 sm:flex"
          title={`Esta conversa usou ${shown.tokens.toLocaleString('pt-BR')} de ${sessions.token_limit.toLocaleString('pt-BR')} tokens`}
        >
          <span className="text-xs text-n-slate-11">
            {tokens(shown.tokens)} de {tokens(sessions.token_limit)} tokens · {brl(shown.cost_brl)}
          </span>
          <span className="h-1 w-32 overflow-hidden rounded-full bg-n-alpha-2" aria-hidden>
            <span
              className={cn('block h-full rounded-full', used >= 0.9 ? 'bg-n-ruby-9' : 'bg-n-iris-9')}
              style={{ width: `${used * 100}%` }}
            />
          </span>
        </div>
      )}
      <Dropdown
        className="max-h-96 w-80 overflow-y-auto"
        trigger={({ toggle }) => (
          <Button
            color="slate"
            variant="ghost"
            icon={History}
            aria-label="Conversas anteriores"
            title="Conversas anteriores"
            onClick={toggle}
          />
        )}
      >
        {(close) =>
          (sessions?.sessions || []).map((s) => (
            <button
              key={s.number}
              type="button"
              role="menuitem"
              aria-current={s.number === viewing}
              onClick={() => {
                onView(s.number);
                close();
              }}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-n-alpha-2',
                s.number === viewing && 'bg-n-alpha-2',
              )}
            >
              <span className="flex items-center justify-between gap-2 text-xs text-n-slate-11">
                <span>{s.number === sessions?.current ? 'Conversa atual' : chatTime(s.started_at)}</span>
                <span>
                  {tokens(s.tokens)} tokens · {brl(s.cost_brl)}
                </span>
              </span>
              <span className="truncate text-sm text-n-slate-12">{s.preview || 'Sem mensagens'}</span>
            </button>
          ))
        }
      </Dropdown>
      <Button
        color="slate"
        variant="ghost"
        icon={SquarePen}
        aria-label="Nova conversa"
        title="Nova conversa"
        disabled={busy}
        onClick={onNew}
      />
    </div>
  );
}
