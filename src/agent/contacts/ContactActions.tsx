import { useState } from 'react';
import { Ban, Merge, MessageCirclePlus, Trash2 } from 'lucide-react';
import { http } from '../api';
import type { Contact, Inbox } from '../types';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/Confirm';
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

/** Chatwoot contact header actions: new conversation, block, merge and delete (administrator). */
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
    <div className="flex flex-wrap gap-2">
      <Button
        size="xs"
        icon={MessageCirclePlus}
        label="Nova conversa"
        onClick={() => setDialog('conversation')}
      />
      <Button
        color={blocked ? 'slate' : 'amber'}
        variant="faded"
        size="xs"
        icon={Ban}
        label={blocked ? 'Desbloquear' : 'Bloquear'}
        onClick={() =>
          void http<Contact>(`/contacts/${contact.id}`, 'PATCH', { blocked: !blocked })
            .then(onSaved)
            .catch((e: Error) => onError(e.message))
        }
      />
      <Button
        color="slate"
        variant="faded"
        size="xs"
        icon={Merge}
        label="Mesclar"
        onClick={() => setDialog('merge')}
      />
      {isAdmin && (
        <Button
          color="ruby"
          variant="faded"
          size="xs"
          icon={Trash2}
          label="Excluir contato"
          onClick={() => setDialog('delete')}
        />
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
        <ConfirmModal
          title="Excluir contato"
          description="O contato e todas as conversas dele serão excluídos permanentemente."
          confirm="Excluir"
          onClose={close}
          onConfirm={async () => {
            await http(`/contacts/${contact.id}`, 'DELETE');
            onDeleted();
          }}
        />
      )}
    </div>
  );
}
