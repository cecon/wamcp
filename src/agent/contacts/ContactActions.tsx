import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

// third-party
import { Ban, Merge, MessageCirclePlus, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../api';
import type { Contact, Inbox } from '../types';
import { MergeModal } from './MergeModal';
import { NewConversationModal } from './NewConversationModal';

interface Props {
  contact: Contact;
  isAdmin: boolean;
  inboxes: Inbox[];
  onSaved: (contact: Contact) => void;
  onMerged: (base: Contact) => void;
  onDeleted: () => void;
  onOpenConversation: (displayId: number) => void;
  onError: (message: string) => void;
}

type Dialog = 'conversation' | 'merge' | 'delete' | null;

/** Ações do contato no C3Theme (lote 11): nova conversa, bloquear, mesclar e excluir (`ActionDialog`). */
export function ContactActions({
  contact,
  isAdmin,
  inboxes,
  onSaved,
  onMerged,
  onDeleted,
  onOpenConversation,
  onError,
}: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const blocked = Boolean(contact.blocked);
  const close = () => setDialog(null);
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MessageCirclePlus size={14} />}
        onClick={() => setDialog('conversation')}
      >
        Nova conversa
      </Button>
      <Button
        size="small"
        variant="outlined"
        color={blocked ? 'secondary' : 'warning'}
        startIcon={<Ban size={14} />}
        onClick={() =>
          void http<Contact>(`/contacts/${contact.id}`, 'PATCH', { blocked: !blocked })
            .then(onSaved)
            .catch((e: Error) => onError(e.message))
        }
      >
        {blocked ? 'Desbloquear' : 'Bloquear'}
      </Button>
      <Button
        size="small"
        variant="outlined"
        startIcon={<Merge size={14} />}
        onClick={() => setDialog('merge')}
      >
        Mesclar
      </Button>
      {isAdmin && (
        <Button
          size="small"
          variant="outlined"
          color="error"
          startIcon={<Trash2 size={14} />}
          onClick={() => setDialog('delete')}
        >
          Excluir contato
        </Button>
      )}
      {dialog === 'conversation' && (
        <NewConversationModal
          contact={contact}
          inboxes={inboxes}
          onClose={close}
          onStarted={(c) => onOpenConversation(c.display_id)}
        />
      )}
      {dialog === 'merge' && <MergeModal contact={contact} onClose={close} onMerged={onMerged} />}
      {dialog === 'delete' && (
        <ActionDialog
          open
          title="Excluir contato"
          description="O contato e todas as conversas dele serão excluídos permanentemente."
          confirmLabel="Excluir"
          backLabel="Cancelar"
          tone="danger"
          onClose={close}
          onConfirm={() =>
            void http(`/contacts/${contact.id}`, 'DELETE')
              .then(() => onDeleted())
              .catch((e: Error) => onError(e.message))
          }
        />
      )}
    </Stack>
  );
}
