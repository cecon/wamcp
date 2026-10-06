import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { formatTime, http, initials, query } from './api';
import type { Contact } from './types';
import { STATUS_LABEL } from './labels';

export function Contacts({ onOpenConversation }: { onOpenConversation: (displayId: number) => void }) {
  const [q, setQ] = useState(''),
    [items, setItems] = useState<Contact[]>([]),
    [selected, setSelected] = useState<Contact | null>(null),
    [form, setForm] = useState({ name: '', email: '' }),
    [message, setMessage] = useState('');
  useEffect(() => {
    const handle = setTimeout(
      () => void http<Contact[]>(`/contacts${query({ q })}`).then(setItems),
      q ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [q]);
  async function open(id: number) {
    const contact = await http<Contact>(`/contacts/${id}`);
    setSelected(contact);
    setForm({ name: contact.name || '', email: contact.email || '' });
    setMessage('');
  }
  async function save() {
    if (!selected) return;
    try {
      const updated = await http<Contact>(`/contacts/${selected.id}`, 'PATCH', {
        name: form.name.trim() || null,
        email: form.email.trim() || null,
      });
      setSelected({ ...selected, ...updated });
      setItems((list) => list.map((c) => (c.id === updated.id ? updated : c)));
      setMessage('Contato salvo.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div className="contacts-page">
      <section className="contact-list">
        <header>
          <h1>Contatos</h1>
          <label className="search">
            <Search size={15} />
            <input placeholder="Nome, telefone ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </header>
        <ul>
          {items.map((c) => (
            <li key={c.id}>
              <button className={selected?.id === c.id ? 'active' : ''} onClick={() => void open(c.id)}>
                <span className="avatar">{initials(c.name || c.phone_number)}</span>
                <span className="item-body">
                  <strong>{c.name || 'Sem nome'}</strong>
                  <small>{c.phone_number || c.email || '—'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 && <p className="muted pad">Nenhum contato encontrado.</p>}
      </section>
      <section className="contact-detail">
        {!selected ? (
          <p className="muted pad">Selecione um contato.</p>
        ) : (
          <>
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <h2>{selected.name || selected.phone_number}</h2>
              <p className="muted">{selected.phone_number}</p>
              <label>
                Nome
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={120}
                />
              </label>
              <label>
                E-mail
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  maxLength={200}
                />
              </label>
              {message && <p className="muted">{message}</p>}
              <button className="btn primary small">Salvar</button>
            </form>
            <div className="panel">
              <h3>Conversas</h3>
              {selected.conversations?.length ? (
                <ul className="plain-list">
                  {selected.conversations.map((c) => (
                    <li key={c.id}>
                      <button className="link" onClick={() => onOpenConversation(c.display_id)}>
                        #{c.display_id} · {c.inbox_name} · {STATUS_LABEL[c.status]} ·{' '}
                        {formatTime(c.last_activity_at)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Sem conversas visíveis para você.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
