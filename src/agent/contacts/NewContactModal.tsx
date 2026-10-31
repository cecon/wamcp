import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../api';
import type { Contact } from '../types';
import { useAction } from '../settings/useAction';

const FIELDS = [
  { key: 'name', label: 'Nome', type: 'text' },
  { key: 'phone_number', label: 'Telefone', type: 'tel' },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'identifier', label: 'Identificador', type: 'text' },
] as const;

/** "Novo contato" no C3Theme (lote 12): o telefone é normalizado para +DDI… e precisa ser único. */
export function NewContactModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Contact) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const { error, busy, run } = useAction();
  const submit = () =>
    void run(async () => {
      const body = Object.fromEntries(
        Object.entries(form)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value),
      );
      onCreated(await http<Contact>('/contacts', 'POST', body));
      onClose();
    });
  return (
    <ActionDialog
      open
      title="Novo contato"
      description="Informe ao menos nome, telefone ou e-mail."
      confirmLabel="Criar contato"
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={submit}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {FIELDS.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            type={field.type}
            size="small"
            value={form[field.key] || ''}
            placeholder={field.key === 'phone_number' ? '+55 11 99999-9999' : undefined}
            onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
        ))}
      </Stack>
    </ActionDialog>
  );
}
