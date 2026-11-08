import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog, SelectField } from '@c3theme/ui';

import { http } from '../api';
import C3Provider from '../c3/C3Provider';
import type { Contact, Conversation, Inbox } from '../types';
import { useAction } from '../settings/useAction';

interface Props {
  contact: Contact;
  inboxes: Inbox[];
  onClose: () => void;
  onStarted: (conversation: Conversation) => void;
}

/** "Nova conversa" no C3Theme (lote 12): caixa de entrada e primeira mensagem. */
export function NewConversationModal({ contact, inboxes, onClose, onStarted }: Props) {
  const [inboxId, setInboxId] = useState(inboxes[0]?.id ?? 0),
    [content, setContent] = useState('');
  const { error, busy, run } = useAction();
  const submit = () =>
    void run(async () => {
      const conversation = await http<Conversation>('/conversations', 'POST', {
        contact_id: contact.id,
        inbox_id: inboxId,
        message: { content: content.trim() },
      });
      onStarted(conversation);
    });
  return (
    <C3Provider>
      <ActionDialog
        open
        title="Nova conversa"
        description={`Envie a primeira mensagem para ${contact.name || contact.phone_number || 'o contato'} pelo WhatsApp.`}
        confirmLabel="Enviar"
        backLabel="Cancelar"
        loading={busy}
        error={error}
        onClose={onClose}
        onConfirm={submit}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <SelectField
            native
            label="Caixa de entrada"
            size="small"
            value={inboxId}
            onChange={(value) => value !== null && setInboxId(Number(value))}
            options={inboxes.map((inbox) => ({ value: inbox.id, label: inbox.name }))}
          />
          <TextField
            label="Mensagem"
            multiline
            minRows={3}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            slotProps={{ htmlInput: { required: true, maxLength: 4096 } }}
          />
        </Stack>
      </ActionDialog>
    </C3Provider>
  );
}
