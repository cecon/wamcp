import { useEffect, useState } from 'react';
import { http, query, timeAgo } from './api';
import type { Contact } from './types';
import { STATUS_LABEL } from './labels';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { SidePanel } from './ui/Overlay';
import { Cell, SettingsHeader, SettingsPage, Table } from './ui/Settings';

/** Chatwoot Contacts: searchable list; a contact opens in a side panel with its conversations. */
export function ContactsPage({ onOpenConversation }: { onOpenConversation: (displayId: number) => void }) {
  const [q, setQ] = useState(''),
    [items, setItems] = useState<Contact[]>([]),
    [selected, setSelected] = useState<Contact | null>(null);
  useEffect(() => {
    const handle = setTimeout(
      () =>
        void http<Contact[]>(`/contacts${query({ q })}`)
          .then(setItems)
          .catch(() => {}),
      q ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <SettingsPage>
      <SettingsHeader
        title="Contatos"
        description="Pessoas que falaram com a sua equipe pelo WhatsApp."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar contatos…' }}
        count={`${items.length} contato${items.length === 1 ? '' : 's'}`}
      />
      <Table
        headers={['Nome', 'E-mail', 'Telefone', 'Última atividade']}
        rows={items.length}
        empty="Nenhum contato encontrado."
      >
        {items.map((c) => (
          <tr
            key={c.id}
            onClick={() => void http<Contact>(`/contacts/${c.id}`).then(setSelected)}
            className="cursor-pointer hover:bg-n-alpha-1"
          >
            <Cell>
              <span className="flex items-center gap-3">
                <Avatar name={c.name || c.phone_number} size={32} />
                <span className="font-medium text-n-slate-12">{c.name || 'Sem nome'}</span>
              </span>
            </Cell>
            <Cell>{c.email || '—'}</Cell>
            <Cell>{c.phone_number || '—'}</Cell>
            <Cell>{c.last_activity_at ? timeAgo(c.last_activity_at) : '—'}</Cell>
          </tr>
        ))}
      </Table>
      {selected && (
        <ContactDetail
          contact={selected}
          onClose={() => setSelected(null)}
          onSaved={(c) => setItems((list) => list.map((x) => (x.id === c.id ? c : x)))}
          onOpenConversation={onOpenConversation}
        />
      )}
    </SettingsPage>
  );
}

interface DetailProps {
  contact: Contact;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
  onOpenConversation: (displayId: number) => void;
}

function ContactDetail({ contact, onClose, onSaved, onOpenConversation }: DetailProps) {
  const [form, setForm] = useState({ name: contact.name || '', email: contact.email || '' }),
    [message, setMessage] = useState('');
  async function save() {
    try {
      const updated = await http<Contact>(`/contacts/${contact.id}`, 'PATCH', {
        name: form.name.trim() || null,
        email: form.email.trim() || null,
      });
      onSaved(updated);
      setMessage('Contato salvo.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <SidePanel title={contact.name || contact.phone_number || 'Contato'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar name={contact.name || contact.phone_number} size={48} />
          <span className="text-sm text-n-slate-11">{contact.phone_number}</span>
        </div>
        <label>
          <span className="field-label">Nome</span>
          <input
            className="field"
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">E-mail</span>
          <input
            className="field"
            type="email"
            value={form.email}
            maxLength={200}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        {message && <p className="text-sm text-n-slate-11">{message}</p>}
        <Button type="submit" label="Salvar contato" className="self-start" />
      </form>
      <h3 className="text-heading-3 mt-8 mb-2">Conversas</h3>
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
    </SidePanel>
  );
}
