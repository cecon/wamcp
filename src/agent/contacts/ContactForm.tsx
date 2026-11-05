import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import type { Contact } from '../types';

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

/** Campos do contato no C3Theme; telefone e identificador só vão quando editados (o telefone é normalizado). */
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
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Stack spacing={2}>
        {FIELDS.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            type={field.type}
            size="small"
            value={form[field.key]}
            onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            slotProps={{ htmlInput: { maxLength: field.max } }}
          />
        ))}
        {message && <Typography variant="body2">{message}</Typography>}
        <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>
          Salvar contato
        </Button>
      </Stack>
    </Box>
  );
}
