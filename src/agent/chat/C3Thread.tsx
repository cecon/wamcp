import { useMemo } from 'react';

// material-ui
import Box from '@mui/material/Box';

// C3Theme
import { Composer, MessageList } from '@c3theme/chat';
import { useDraft, useMessageWindow, type Author } from '@c3theme/chat/core';

import C3Provider from '../c3/C3Provider';
import { formatWhatsApp } from '../conversations/whatsappFormat';
import { createChatTransport } from './c3Transport';

interface Props {
  displayId: number;
  contactName: string;
  currentUserId: number;
  currentUserName: string;
  realtime: Parameters<typeof createChatTransport>[0]['realtime'];
  disabled?: boolean;
}

/**
 * Thread de conversa no `@c3theme/chat` (frente de chat da adoção): `MessageList` virtualizada + `Composer`, ligados
 * à API atual pelo `createChatTransport`. Fica atrás de `?c3chat` enquanto o thread nativo (formatação WhatsApp,
 * reações, notas privadas, respostas prontas e áudio próprios) não é substituído por completo.
 */
export function C3Thread({
  displayId,
  contactName,
  currentUserId,
  currentUserName,
  realtime,
  disabled,
}: Props) {
  const me = useMemo<Author>(
    () => ({ id: String(currentUserId), name: currentUserName }),
    [currentUserId, currentUserName],
  );
  const transport = useMemo(
    () => createChatTransport({ displayId, contactName, realtime, me }),
    [displayId, contactName, realtime, me],
  );
  const window = useMessageWindow(transport, String(displayId), { me, pageSize: 50 });
  const draft = useDraft(String(displayId));

  return (
    <C3Provider>
      <Box
        sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, bgcolor: 'background.paper' }}
      >
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <MessageList
            messages={window.messages}
            title={contactName}
            hasMore={window.hasMore}
            loadingOlder={window.loading === 'older'}
            onLoadOlder={() => void window.loadOlder()}
            renderText={(text) => formatWhatsApp(text)}
            empty="Nenhuma mensagem ainda."
          />
        </Box>
        <Composer
          value={draft.text}
          onChange={draft.setText}
          onSend={(text, files) => {
            window.send(text, files.length ? { files } : {});
            draft.clear();
          }}
          disabled={disabled}
        />
      </Box>
    </C3Provider>
  );
}
