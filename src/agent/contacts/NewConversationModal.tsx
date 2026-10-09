import { useState } from 'react';
import { http } from '../api';
import type { Contact, Conversation, Inbox } from '../types';
import { useAction } from '../settings/useAction';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';

interface Props {
  contact: Contact;
  inboxes: Inbox[];
  onClose: () => void;
  onStarted: (conversation: Conversation) => void;
}

/** Chatwoot "Nova conversa" from a contact: inbox and first message (reopens an open conversation). */
export function NewConversationModal({ contact, inboxes, onClose, onStarted }: Props) {
  const [inboxId, setInboxId] = useState(inboxes[0]?.id ?? 0),
    [content, setContent] = useState('');
  const { error, busy, run } = useAction();
  return (
    <Modal
      title="Nova conversa"
      description={`Envie a primeira mensagem para ${contact.name || contact.phone_number || 'o contato'} pelo WhatsApp.`}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const conversation = await http<Conversation>('/conversations', 'POST', {
              contact_id: contact.id,
              inbox_id: inboxId,
              message: { content: content.trim() },
            });
            onStarted(conversation);
          });
        }}
      >
        <label>
          <span className="field-label">Caixa de entrada</span>
          <select
            className="field"
            value={inboxId}
            required
            onChange={(e) => setInboxId(Number(e.target.value))}
          >
            {inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Mensagem</span>
          <textarea
            className="field"
            value={content}
            required
            maxLength={4096}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <ModalFooter busy={busy} submit="Enviar" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
