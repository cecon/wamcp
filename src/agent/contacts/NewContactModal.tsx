import { useState } from 'react';
import { http } from '../api';
import type { Contact } from '../types';
import { useAction } from '../settings/useAction';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';

const FIELDS = [
  { key: 'name', label: 'Nome', type: 'text' },
  { key: 'phone_number', label: 'Telefone', type: 'tel' },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'identifier', label: 'Identificador', type: 'text' },
] as const;

/** Chatwoot "Novo contato": the phone is normalised to +DDI… and must be unique. */
export function NewContactModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Contact) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const { error, busy, run } = useAction();
  return (
    <Modal title="Novo contato" description="Informe ao menos nome, telefone ou e-mail." onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = Object.fromEntries(
              Object.entries(form)
                .map(([k, v]) => [k, v.trim()])
                .filter(([, v]) => v),
            );
            onCreated(await http<Contact>('/contacts', 'POST', body));
            onClose();
          });
        }}
      >
        {FIELDS.map((f) => (
          <label key={f.key}>
            <span className="field-label">{f.label}</span>
            <input
              className="field"
              type={f.type}
              value={form[f.key] || ''}
              maxLength={120}
              placeholder={f.key === 'phone_number' ? '+55 11 99999-9999' : undefined}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </label>
        ))}
        <ModalFooter busy={busy} submit="Criar contato" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
