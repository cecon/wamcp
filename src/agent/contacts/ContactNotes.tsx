import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { http } from '../api';
import type { ContactNote } from '../types';
import { Button } from '../ui/Button';

interface Props {
  contactId: number;
  onError: (message: string) => void;
}

/** Chatwoot contact notes: add a note, list newest first, delete (author or administrator). */
export function ContactNotes({ contactId, onError }: Props) {
  const [notes, setNotes] = useState<ContactNote[]>([]),
    [draft, setDraft] = useState('');
  const path = `/contacts/${contactId}/notes`;
  useEffect(() => {
    void http<ContactNote[]>(path)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [path]);
  const fail = (e: Error) => onError(e.message);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void http<ContactNote>(path, 'POST', { content: draft.trim() })
            .then((note) => {
              setNotes((list) => [note, ...list]);
              setDraft('');
            })
            .catch(fail);
        }}
      >
        <textarea
          className="field"
          aria-label="Nova nota"
          placeholder="Escreva uma nota sobre o contato…"
          value={draft}
          maxLength={5000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="xs"
          label="Adicionar nota"
          className="self-end"
          disabled={!draft.trim()}
        />
      </form>
      {notes.length === 0 && <p className="text-sm text-n-slate-11">Nenhuma nota ainda.</p>}
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-n-slate-2 p-3 text-sm">
            <p className="whitespace-pre-wrap text-n-slate-12">{n.content}</p>
            <div className="mt-1 flex items-center justify-between text-xs text-n-slate-11">
              <span>
                {n.user_name || 'Sistema'} · {new Date(n.created_at * 1000).toLocaleString('pt-BR')}
              </span>
              <Button
                color="slate"
                variant="ghost"
                size="xs"
                icon={Trash2}
                aria-label="Excluir nota"
                onClick={() =>
                  void http(`${path}/${n.id}`, 'DELETE')
                    .then(() => setNotes((list) => list.filter((x) => x.id !== n.id)))
                    .catch(fail)
                }
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
