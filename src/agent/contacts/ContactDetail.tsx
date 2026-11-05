import { useState, type ReactNode } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { RefreshCw, X } from 'lucide-react';

import { http, timeAgo } from '../api';
import type { Catalog, Contact, FilterValue } from '../types';
import { STATUS_LABEL } from '../labels';
import { AttributesSection } from '../attributes/AttributesSection';
import { Avatar } from '../ui/Avatar';
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
  <Box component="section" sx={{ mt: 3 }}>
    <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
      {title}
    </Typography>
    {children}
  </Box>
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
    <Dialog
      open
      onClose={onClose}
      sx={{
        '& .MuiDialog-container': { justifyContent: 'flex-end', alignItems: 'stretch' },
        '& .MuiDialog-paper': {
          m: 1.5,
          width: 560,
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: 'none',
          borderRadius: 1.5,
        },
      }}
    >
      <DialogTitle
        component="div"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: 1,
          borderColor: 'divider',
          py: 1.5,
          px: 2.5,
        }}
      >
        <Typography variant="h6" component="h2">
          {name || 'Contato'}
        </Typography>
        <IconButton size="small" aria-label="Fechar" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
          {contact.avatar_url ? (
            <Box
              component="img"
              src={contact.avatar_url}
              alt="Foto do contato"
              sx={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <Avatar name={name} size={48} />
          )}
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {contact.phone_number}
            </Typography>
            {contact.blocked ? (
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'error.main' }}>
                Bloqueado
              </Typography>
            ) : null}
          </Stack>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshCw size={14} />}
            onClick={() =>
              void http<Contact>(`/contacts/${contact.id}/avatar`, 'POST')
                .then(saved)
                .catch((e: Error) => setError(e.message))
            }
          >
            Atualizar foto
          </Button>
        </Stack>
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
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ mt: 2 }}>
          <ContactForm contact={contact} onSaved={saved} />
        </Box>
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
            <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {contact.conversations.map((c) => (
                <Box component="li" key={c.id}>
                  <ButtonBase
                    onClick={() => onOpenConversation(c.display_id)}
                    sx={{
                      width: '100%',
                      borderRadius: 1,
                      px: 1,
                      py: 0.75,
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      gap: 0.5,
                    }}
                  >
                    <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                      #{c.display_id}
                    </Typography>{' '}
                    <Typography component="span" variant="body2" color="text.secondary">
                      {c.inbox_name} · {STATUS_LABEL[c.status]} · {timeAgo(c.last_activity_at)}
                    </Typography>
                  </ButtonBase>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Sem conversas visíveis para você.
            </Typography>
          )}
        </Section>
      </DialogContent>
    </Dialog>
  );
}
