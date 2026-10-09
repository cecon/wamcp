import { useEffect, useState } from 'react';
import { http, query } from '../api';
import type { Contact } from '../types';
import { useAction } from '../settings/useAction';
import { Avatar } from '../ui/Avatar';
import { cn } from '../ui/cn';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';

interface Props {
  contact: Contact;
  onClose: () => void;
  onMerged: (base: Contact) => void;
}

const label = (c: Contact) => c.name || c.phone_number || c.email || `Contato ${c.id}`;

/** Chatwoot MergeContact: pick the contact to keep; the current one moves into it and is removed. */
export function MergeModal({ contact, onClose, onMerged }: Props) {
  const [q, setQ] = useState(''),
    [results, setResults] = useState<Contact[]>([]),
    [base, setBase] = useState<Contact | null>(null);
  const { error, busy, run } = useAction();
  useEffect(() => {
    if (!q.trim()) return;
    const handle = setTimeout(
      () =>
        void http<Contact[]>(`/contacts${query({ q: q.trim() })}`)
          .then((list) => setResults(list.filter((c) => c.id !== contact.id)))
          .catch(() => setResults([])),
      250,
    );
    return () => clearTimeout(handle);
  }, [q, contact.id]);

  return (
    <Modal
      title="Mesclar contato"
      description="Escolha o contato que será mantido. Conversas, notas, etiquetas e canais deste contato passam para ele."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!base) return;
          void run(async () => {
            const merged = await http<Contact>('/actions/contact_merge', 'POST', {
              base_contact_id: base.id,
              mergee_contact_id: contact.id,
            });
            onMerged(merged);
            onClose();
          });
        }}
      >
        <input
          className="field"
          aria-label="Pesquisar contato para mesclar"
          placeholder="Nome, telefone ou e-mail…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {q.trim() &&
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={base?.id === c.id}
                  onClick={() => setBase(c)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-n-alpha-2',
                    base?.id === c.id && 'bg-n-blue-3',
                  )}
                >
                  <Avatar name={label(c)} size={24} />
                  <span className="flex-1 truncate">{label(c)}</span>
                  <span className="text-xs text-n-slate-11">{c.phone_number}</span>
                </button>
              </li>
            ))}
        </ul>
        {base && (
          <p className="rounded-lg bg-n-amber-3 p-3 text-sm text-n-amber-12">
            “{label(contact)}” será mesclado em “{label(base)}” e removido. Esta ação não pode ser desfeita.
          </p>
        )}
        <ModalFooter busy={busy || !base} submit="Mesclar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
