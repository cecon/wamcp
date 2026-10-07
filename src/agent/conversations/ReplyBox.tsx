import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { http, query } from '../api';
import type { Canned, Message } from '../types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

interface Props {
  path: string;
  disabled: boolean;
  onSent: (message: Message) => void;
}

/**
 * Chatwoot ReplyBox: Reply / Private Note pill toggle, editor, bottom panel with Send.
 * Typing "/shortcut" opens the canned responses picker (list + preview), like CannedResponse.vue.
 */
export function ReplyBox({ path, disabled, onSent }: Props) {
  const [text, setText] = useState(''),
    [note, setNote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [canned, setCanned] = useState<Canned[]>([]),
    [highlight, setHighlight] = useState(0);
  const shortcut = /^\/(\S*)$/.exec(text)?.[1];
  const blocked = disabled && !note;

  useEffect(() => {
    if (shortcut === undefined) return;
    const handle = setTimeout(
      () =>
        void http<Canned[]>(`/canned_responses${query({ q: shortcut })}`)
          .then((list) => {
            setCanned(list.slice(0, 8));
            setHighlight(0);
          })
          .catch(() => setCanned([])),
      150,
    );
    return () => clearTimeout(handle);
  }, [shortcut]);
  const options = shortcut !== undefined ? canned : [];
  const preview = options[highlight];

  async function send() {
    const content = text.trim();
    if (!content || busy || blocked) return;
    setBusy(true);
    setError('');
    try {
      onSent(await http<Message>(`${path}/messages`, 'POST', { content, private: note }));
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        'relative mx-2 mb-2 rounded-xl border',
        note ? 'border-n-amber-12/5 bg-n-solid-amber' : 'border-n-weak bg-n-solid-1',
      )}
    >
      {options.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 flex h-60 w-full max-w-[768px] overflow-hidden rounded-xl border border-n-strong bg-n-alpha-3 shadow-lg backdrop-blur-[100px]">
          <div className="flex w-full max-w-[420px] flex-col border-r border-n-weak">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-n-weak px-3 text-sm text-n-slate-11">
              <Search size={14} /> Respostas prontas: /{shortcut}
            </div>
            <ul role="listbox" aria-label="Respostas prontas" className="overflow-y-auto p-1">
              {options.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => setText(c.content)}
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
      )}
      <div className="flex h-[3.25rem] items-center justify-between pr-2 pl-3">
        <div
          role="tablist"
          className="relative flex h-8 items-center rounded-full border border-n-weak bg-n-alpha-2 p-1 text-sm"
        >
          {[
            [false, 'Responder'],
            [true, 'Nota privada'],
          ].map(([isNote, label]) => (
            <button
              key={String(label)}
              type="button"
              role="tab"
              aria-selected={note === isNote}
              onClick={() => setNote(Boolean(isNote))}
              className={cn(
                'h-6 rounded-full px-2 transition-colors',
                note === isNote ? 'bg-n-solid-1 font-medium text-n-slate-12 shadow-sm' : 'text-n-slate-11',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={text}
        disabled={blocked}
        rows={3}
        maxLength={4096}
        aria-label={note ? 'Nota privada' : 'Mensagem'}
        placeholder={
          blocked
            ? 'Conversa resolvida. Reabra para responder ou escreva uma nota privada.'
            : note
              ? 'Esta nota é visível apenas para a equipe.'
              : "Shift + Enter para nova linha. Digite '/' para selecionar uma resposta pronta."
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
          } else if (options.length && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            setText(options[highlight].content);
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        className="block w-full resize-none bg-transparent px-3 text-sm text-n-slate-12 outline-none placeholder:text-n-slate-10 disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-between p-3">
        <span className="text-xs text-n-ruby-11">{error}</span>
        <Button
          color={note ? 'amber' : 'blue'}
          label={note ? 'Adicionar nota (↵)' : 'Enviar (↵)'}
          disabled={busy || !text.trim() || blocked}
          onClick={() => void send()}
        />
      </div>
    </div>
  );
}
