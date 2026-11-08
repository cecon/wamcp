import { useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http, query } from '../api';
import type { Contact } from '../types';
import { Avatar } from '../ui/Avatar';
import { useAction } from '../settings/useAction';

interface Props {
  contact: Contact;
  onClose: () => void;
  onMerged: (base: Contact) => void;
}

const label = (c: Contact) => c.name || c.phone_number || c.email || `Contato ${c.id}`;

/** "Mesclar contato" no C3Theme (lote 12): escolhe quem fica; o atual é movido e removido. */
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
  const submit = () =>
    void run(async () => {
      if (!base) return;
      const merged = await http<Contact>('/actions/contact_merge', 'POST', {
        base_contact_id: base.id,
        mergee_contact_id: contact.id,
      });
      onMerged(merged);
      onClose();
    });
  return (
    <ActionDialog
      open
      title="Mesclar contato"
      description="Escolha o contato que será mantido. Conversas, notas, etiquetas e canais deste contato passam para ele."
      confirmLabel="Mesclar"
      backLabel="Cancelar"
      loading={busy || !base}
      error={error}
      onClose={onClose}
      onConfirm={submit}
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        <TextField
          size="small"
          value={q}
          placeholder="Nome, telefone ou e-mail…"
          onChange={(event) => setQ(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Pesquisar contato para mesclar' } }}
        />
        <Box
          component="ul"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            listStyle: 'none',
            m: 0,
            p: 0,
            maxHeight: 224,
            overflowY: 'auto',
          }}
        >
          {q.trim() &&
            results.map((candidate) => (
              <Box component="li" key={candidate.id}>
                <Button
                  fullWidth
                  variant={base?.id === candidate.id ? 'contained' : 'text'}
                  aria-pressed={base?.id === candidate.id}
                  onClick={() => setBase(candidate)}
                  startIcon={<Avatar name={label(candidate)} size={24} />}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                >
                  <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {label(candidate)}
                  </Box>
                  <Typography variant="caption" component="span" sx={{ ml: 1, opacity: 0.7 }}>
                    {candidate.phone_number}
                  </Typography>
                </Button>
              </Box>
            ))}
        </Box>
        {base && (
          <Box sx={{ borderRadius: 1.5, bgcolor: 'warning.main', color: 'warning.contrastText', p: 1.5 }}>
            <Typography variant="body2" color="inherit">
              “{label(contact)}” será mesclado em “{label(base)}” e removido. Esta ação não pode ser desfeita.
            </Typography>
          </Box>
        )}
      </Stack>
    </ActionDialog>
  );
}
