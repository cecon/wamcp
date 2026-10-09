import { useEffect, useState, type ReactNode } from 'react';
import { AtSign, Mail, Phone, X } from 'lucide-react';
import { http, timeAgo } from '../api';
import type { Catalog, Contact, Conversation, FilterValue, User } from '../types';
import { STATUS_LABEL } from '../labels';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { AttributesSection } from '../attributes/AttributesSection';
import { Accordion } from '../ui/Accordion';
import { ConversationActions } from './ConversationActions';
import { ParticipantsSection } from './ParticipantsSection';
import { MacroRunner } from '../macros/MacroRunner';
import { SlaSection } from '../sla/SlaSection';
import { CatalogLookup } from '../catalog/CatalogLookup';

const Row = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <p className="flex min-w-0 items-center gap-2 text-sm text-n-slate-11">
    <span className="shrink-0 text-n-slate-10">{icon}</span>
    <span className="truncate">{children}</span>
  </p>
);

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
  onOpenConversation: (displayId: number) => void;
  onClose: () => void;
}

/** Chatwoot ConversationSidebar / ContactPanel: contact info then reorderable accordion sections. */
export function ContactPanel({
  conversation: c,
  user,
  catalog,
  onChange,
  onError,
  onOpenConversation,
  onClose,
}: Props) {
  const [contact, setContact] = useState<Contact | null>(null);
  useEffect(() => {
    void http<Contact>(`/contacts/${c.contact_id}`)
      .then(setContact)
      .catch(() => setContact(null));
  }, [c.contact_id, c.id]);
  const name = c.contact_name || c.contact_phone || 'Contato';
  const saveConversationAttribute = async (key: string, value: FilterValue | null) =>
    onChange(
      await http<Conversation>(`/conversations/${c.display_id}/custom_attributes`, 'POST', {
        custom_attributes: { [key]: value },
      }),
    );
  const saveContactAttribute = async (key: string, value: FilterValue | null) =>
    setContact({
      ...contact,
      ...(await http<Contact>(`/contacts/${c.contact_id}`, 'PATCH', { custom_attributes: { [key]: value } })),
    });
  const previous = (contact?.conversations || []).filter((p) => p.id !== c.id);

  return (
    <aside
      aria-label="Painel do contato"
      className="hidden h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l border-n-weak bg-n-surface-2 xl:flex 2xl:w-[360px]"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-n-weak px-4 py-2">
        <span className="text-sm font-medium text-n-slate-12">Contato</span>
        <Button color="slate" variant="ghost" icon={X} aria-label="Fechar painel" onClick={onClose} />
      </div>
      <div className="flex flex-col gap-2 p-4">
        <Avatar name={name} src={contact?.avatar_url ?? c.contact_avatar_url} size={48} />
        <p className="mt-1 text-base font-medium text-n-slate-12">{name}</p>
        {contact?.email && <Row icon={<Mail size={14} />}>{contact.email}</Row>}
        {c.contact_phone && <Row icon={<Phone size={14} />}>{c.contact_phone}</Row>}
        <Row icon={<AtSign size={14} />}>{c.contact_jid}</Row>
      </div>
      <div className="flex flex-col gap-3 px-2 pb-8">
        <Accordion title="Ações da conversa" open>
          <ConversationActions
            conversation={c}
            user={user}
            catalog={catalog}
            onChange={onChange}
            onError={onError}
          />
        </Accordion>
        <Accordion title="SLA">
          {/* Remounts (and reloads the deadlines) when the conversation status or waiting time changes. */}
          <SlaSection key={`${c.display_id}:${c.status}:${c.waiting_since ?? ''}`} displayId={c.display_id} />
        </Accordion>
        <Accordion title="Macros">
          <MacroRunner conversation={c} onChange={onChange} />
        </Accordion>
        <Accordion title="Catálogo">
          <CatalogLookup path={`/conversations/${c.display_id}`} />
        </Accordion>
        <Accordion title="Participantes da conversa">
          <ParticipantsSection conversation={c} user={user} catalog={catalog} onError={onError} />
        </Accordion>
        <Accordion title="Atributos da conversa">
          <AttributesSection
            model="conversation"
            values={c.custom_attributes}
            onSave={saveConversationAttribute}
          />
        </Accordion>
        <Accordion title="Atributos do contato">
          <AttributesSection
            model="contact"
            values={contact?.custom_attributes}
            onSave={saveContactAttribute}
          />
        </Accordion>
        <Accordion title="Informações da conversa">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-n-slate-11">Número</dt>
            <dd className="text-n-slate-12">#{c.display_id}</dd>
            <dt className="text-n-slate-11">Caixa</dt>
            <dd className="text-n-slate-12">{c.inbox_name}</dd>
            <dt className="text-n-slate-11">Status</dt>
            <dd className="text-n-slate-12">{STATUS_LABEL[c.status]}</dd>
            <dt className="text-n-slate-11">Última atividade</dt>
            <dd className="text-n-slate-12">{timeAgo(c.last_activity_at)}</dd>
          </dl>
        </Accordion>
        <Accordion title="Conversas anteriores">
          {previous.length === 0 ? (
            <p className="text-sm text-n-slate-11">Nenhuma conversa anterior.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {previous.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpenConversation(p.display_id)}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-n-alpha-2"
                  >
                    <span className="font-medium text-n-slate-12">#{p.display_id}</span>{' '}
                    <span className="text-n-slate-11">
                      {p.inbox_name} · {STATUS_LABEL[p.status]} · {timeAgo(p.last_activity_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Accordion>
      </div>
    </aside>
  );
}
