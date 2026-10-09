import { useState } from 'react';
import { Bell, BellOff, Download, EllipsisVertical, MailOpen, Trash2 } from 'lucide-react';
import { download, http } from '../api';
import type { Conversation } from '../types';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/Confirm';
import { Dropdown, MenuItem } from '../ui/Overlay';

interface Props {
  conversation: Conversation;
  isAdmin: boolean;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
  /** Leaves the conversation (after "mark as unread" and deletion, like Chatwoot). */
  onLeave: () => void;
  onDeleted: () => void;
}

/** Chatwoot conversation header "more" menu: unread, mute, transcript and delete (admin). */
export function ConversationMenu({ conversation: c, isAdmin, onChange, onError, onLeave, onDeleted }: Props) {
  const [confirm, setConfirm] = useState(false);
  const path = `/conversations/${c.display_id}`;
  const run = (action: () => Promise<unknown>) => void action().catch((e: Error) => onError(e.message));
  const items = [
    {
      icon: MailOpen,
      label: 'Marcar como não lida',
      action: () =>
        run(async () => {
          await http(`${path}/unread`, 'POST');
          onLeave();
        }),
    },
    c.muted
      ? {
          icon: Bell,
          label: 'Reativar notificações',
          action: () => run(async () => onChange(await http<Conversation>(`${path}/unmute`, 'POST'))),
        }
      : {
          icon: BellOff,
          label: 'Silenciar conversa',
          action: () => run(async () => onChange(await http<Conversation>(`${path}/mute`, 'POST'))),
        },
    {
      icon: Download,
      label: 'Baixar transcrição',
      action: () => run(() => download(`${path}/transcript`, `conversa-${c.display_id}.txt`)),
    },
  ];

  return (
    <>
      <Dropdown
        className="w-60"
        trigger={({ toggle }) => (
          <Button
            color="slate"
            variant="ghost"
            icon={EllipsisVertical}
            aria-label="Mais ações"
            onClick={toggle}
          />
        )}
      >
        {(close) => (
          <>
            {items.map((item) => (
              <MenuItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                onClick={() => {
                  close();
                  item.action();
                }}
              />
            ))}
            {isAdmin && (
              <MenuItem
                icon={Trash2}
                danger
                label="Excluir conversa"
                onClick={() => {
                  close();
                  setConfirm(true);
                }}
              />
            )}
          </>
        )}
      </Dropdown>
      {confirm && (
        <ConfirmModal
          title="Excluir conversa"
          description={`A conversa #${c.display_id} e todas as mensagens dela serão excluídas permanentemente.`}
          confirm="Excluir"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await http(path, 'DELETE');
            onDeleted();
          }}
        />
      )}
    </>
  );
}
