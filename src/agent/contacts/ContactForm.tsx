import { useState } from 'react';
import { http } from '../api';
import type { Contact } from '../types';
import { Button } from '../ui/Button';

const FIELDS = [
  { key: 'name', label: 'Nome', type: 'text', max: 120 },
  { key: 'email', label: 'E-mail', type: 'email', max: 200 },
  { key: 'phone_number', label: 'Telefone', type: 'tel', max: 30 },
  { key: 'identifier', label: 'Identificador', type: 'text', max: 120 },
] as const;
type Key = (typeof FIELDS)[number]['key'];

interface Props {
  contact: Contact;
  onSaved: (contact: Contact) => void;
}

/** Contact fields; phone and identifier are sent only when edited (the phone is re-normalised and must be unique). */
export function ContactForm({ contact, onSaved }: Props) {
  const initial = Object.fromEntries(FIELDS.map((f) => [f.key, contact[f.key] || ''])) as Record<Key, string>;
  const [form, setForm] = useState(initial),
    [message, setMessage] = useState('');
  async function save() {
    const body: Partial<Record<Key, string | null>> = {
      name: form.name.trim() || null,
      email: form.email.trim() || null,
    };
    for (const key of ['phone_number', 'identifier'] as const)
      if (form[key] !== initial[key]) body[key] = form[key].trim() || null;
    try {
      onSaved(await http<Contact>(`/contacts/${contact.id}`, 'PATCH', body));
      setMessage('Contato salvo.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {FIELDS.map((f) => (
        <label key={f.key}>
          <span className="field-label">{f.label}</span>
          <input
            className="field"
            type={f.type}
            value={form[f.key]}
            maxLength={f.max}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
          />
        </label>
      ))}
      {message && <p className="text-sm text-n-slate-11">{message}</p>}
      <Button type="submit" label="Salvar contato" className="self-start" />
    </form>
  );
}
