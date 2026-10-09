import { useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { http, timeAgo } from '../api';
import type { Catalog, Contact, FilterValue } from '../types';
import { STATUS_LABEL } from '../labels';
import { AttributesSection } from '../attributes/AttributesSection';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { SidePanel } from '../ui/Overlay';
import { ContactActions } from './ContactActions';
import { ContactForm } from './ContactForm';
import { ContactLabels } from './ContactLabels';
import { ContactNotes } from './ContactNotes';

interface Props {
  contact: Contact;
  catalog: Catalog;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
  onMerged: (base: Contact) => void;
  onDeleted: (id: number) => void;
  onOpenConversation: (displayId: number) => void;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-8">
    <h3 className="text-heading-3 mb-2">{title}</h3>
    {children}
  </section>
);

/** Chatwoot contact details: photo, actions, fields, labels, attributes, notes and conversations. */
export function ContactDetail({
  contact: initial,
  catalog,
  isAdmin,
  onClose,
  onSaved,
  onMerged,
  onDeleted,
  onOpenConversation,
}: Props) {
  const [contact, setContact] = useState(initial),
    [error, setError] = useState('');
  const name = contact.name || contact.phone_number;
  const saved = (updated: Contact) => {
    const next = { ...contact, ...updated };
    setContact(next);
    onSaved(next);
  };
  const saveAttribute = async (key: string, value: FilterValue | null) =>
    saved(await http<Contact>(`/contacts/${contact.id}`, 'PATCH', { custom_attributes: { [key]: value } }));

  return (
    <SidePanel title={name || 'Contato'} onClose={onClose}>
      <div className="mb-4 flex items-center gap-3">
        {contact.avatar_url ? (
          <img src={contact.avatar_url} alt="Foto do contato" className="size-12 rounded-full object-cover" />
        ) : (
          <Avatar name={name} size={48} />
        )}
        <div className="flex flex-1 flex-col">
          <span className="text-sm text-n-slate-11">{contact.phone_number}</span>
          {contact.blocked ? <span className="text-xs font-medium text-n-ruby-11">Bloqueado</span> : null}
        </div>
        <Button
          color="slate"
          variant="faded"
          size="xs"
          icon={RefreshCw}
          label="Atualizar foto"
          onClick={() =>
            void http<Contact>(`/contacts/${contact.id}/avatar`, 'POST')
              .then(saved)
              .catch((e: Error) => setError(e.message))
          }
        />
      </div>
      <ContactActions
        contact={contact}
        isAdmin={isAdmin}
        inboxes={catalog.inboxes}
        onSaved={saved}
        onMerged={onMerged}
        onDeleted={() => onDeleted(contact.id)}
        onOpenConversation={onOpenConversation}
        onError={setError}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <div className="mt-6">
        <ContactForm contact={contact} onSaved={saved} />
      </div>
      <Section title="Etiquetas">
        <ContactLabels contact={contact} labels={catalog.labels} onSaved={saved} onError={setError} />
      </Section>
      <Section title="Atributos">
        <AttributesSection model="contact" values={contact.custom_attributes} onSave={saveAttribute} />
      </Section>
      <Section title="Notas">
        <ContactNotes contactId={contact.id} onError={setError} />
      </Section>
      <Section title="Conversas">
        {contact.conversations?.length ? (
          <ul className="flex flex-col gap-1">
            {contact.conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(c.display_id)}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-n-alpha-2"
                >
                  <span className="font-medium">#{c.display_id}</span>{' '}
                  <span className="text-n-slate-11">
                    {c.inbox_name} · {STATUS_LABEL[c.status]} · {timeAgo(c.last_activity_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-n-slate-11">Sem conversas visíveis para você.</p>
        )}
      </Section>
    </SidePanel>
  );
}
