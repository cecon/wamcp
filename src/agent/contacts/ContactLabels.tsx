import { Plus, X } from 'lucide-react';
import { http } from '../api';
import type { Contact, Label } from '../types';
import { Button } from '../ui/Button';
import { Dropdown, MenuItem } from '../ui/Overlay';

interface Props {
  contact: Contact;
  labels: Label[];
  onSaved: (contact: Contact) => void;
  onError: (message: string) => void;
}

/** Contact labels (Chatwoot ContactLabels): chips with remove plus an "add" menu of existing labels. */
export function ContactLabels({ contact, labels, onSaved, onError }: Props) {
  const current = contact.labels || [];
  const available = labels.filter((l) => !current.includes(l.title));
  const save = (next: string[]) =>
    void http<Contact>(`/contacts/${contact.id}/labels`, 'POST', { labels: next })
      .then(onSaved)
      .catch((e: Error) => onError(e.message));
  const color = (title: string) => labels.find((l) => l.title === title)?.color || '#8B8D98';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {current.map((title) => (
        <span
          key={title}
          className="flex h-6 items-center gap-1.5 rounded-lg bg-n-label-color pr-1 pl-2 text-xs text-n-slate-12 outline outline-1 -outline-offset-1 outline-n-label-border"
        >
          <span className="size-2 rounded-sm" style={{ background: color(title) }} />
          {title}
          <Button
            color="slate"
            variant="ghost"
            size="xs"
            icon={X}
            aria-label={`Remover etiqueta ${title}`}
            className="!size-4"
            onClick={() => save(current.filter((l) => l !== title))}
          />
        </span>
      ))}
      <Dropdown
        align="start"
        className="max-h-60 w-56 overflow-y-auto"
        trigger={({ toggle }) => (
          <Button
            color="blue"
            variant="faded"
            size="xs"
            icon={Plus}
            label="Adicionar etiqueta"
            onClick={toggle}
          />
        )}
      >
        {(close) =>
          available.length === 0 ? (
            <p className="p-2 text-sm text-n-slate-11">Nenhuma etiqueta disponível.</p>
          ) : (
            available.map((l) => (
              <MenuItem
                key={l.id}
                label={l.title}
                onClick={() => {
                  close();
                  save([...current, l.title]);
                }}
              />
            ))
          )
        }
      </Dropdown>
    </div>
  );
}
