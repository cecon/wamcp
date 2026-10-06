import { useEffect, useState } from 'react';
import { Lock, Send } from 'lucide-react';
import { http, query } from '../api';
import type { Canned, Message } from '../types';

interface Props {
  path: string;
  disabled: boolean;
  onSent: (message: Message) => void;
}

/** Reply / private note editor. Typing "/atalho" suggests canned responses; Enter sends, Shift+Enter breaks. */
export function Composer({ path, disabled, onSent }: Props) {
  const [text, setText] = useState(''),
    [note, setNote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [suggestions, setSuggestions] = useState<Canned[]>([]),
    [highlight, setHighlight] = useState(0);
  const shortcut = /^\/(\S*)$/.exec(text)?.[1];

  useEffect(() => {
    if (shortcut === undefined) return;
    const handle = setTimeout(
      () =>
        void http<Canned[]>(`/canned_responses${query({ q: shortcut })}`)
          .then((list) => {
            setSuggestions(list.slice(0, 6));
            setHighlight(0);
          })
          .catch(() => setSuggestions([])),
      150,
    );
    return () => clearTimeout(handle);
  }, [shortcut]);
  const visible = shortcut !== undefined ? suggestions : [];

  async function send() {
    const content = text.trim();
    if (!content || busy) return;
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
  const pick = (canned: Canned) => setText(canned.content);

  return (
    <form
      className={`composer ${note ? 'note' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {visible.length > 0 && (
        <ul className="canned" role="listbox">
          {visible.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === highlight}>
              <button type="button" className={i === highlight ? 'active' : ''} onClick={() => pick(c)}>
                <strong>/{c.short_code}</strong>
                <span>{c.content}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-modes" role="tablist">
        <button type="button" className={!note ? 'active' : ''} onClick={() => setNote(false)}>
          Responder
        </button>
        <button type="button" className={note ? 'active' : ''} onClick={() => setNote(true)}>
          <Lock size={12} /> Nota interna
        </button>
      </div>
      <textarea
        value={text}
        disabled={disabled && !note}
        placeholder={
          disabled && !note
            ? 'Conversa resolvida. Reabra para responder ou escreva uma nota interna.'
            : note
              ? 'Nota visível apenas para a equipe'
              : 'Digite a mensagem… ( / para respostas prontas)'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (visible.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length);
          } else if (visible.length && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            pick(visible[highlight]);
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={3}
        maxLength={4096}
      />
      <div className="composer-footer">
        {error ? (
          <span className="form-error">{error}</span>
        ) : (
          <span className="muted">Shift+Enter quebra linha</span>
        )}
        <button className="btn primary small" disabled={busy || !text.trim() || (disabled && !note)}>
          <Send size={14} /> {note ? 'Salvar nota' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}
