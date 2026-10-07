import { useState } from 'react';
import { Copy, Reply, SmilePlus, Trash2 } from 'lucide-react';
import type { Message } from '../types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { Dropdown, Modal } from '../ui/Overlay';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface MessageHandlers {
  onReply: (message: Message) => void;
  /** Empty emoji removes the agent's reaction. */
  onReact: (message: Message, emoji: string) => void;
  onDelete: (message: Message) => void;
  onRetry: (message: Message) => void;
  onJump: (id: number) => void;
}

interface Props {
  message: Message;
  outgoing: boolean;
  myReaction?: string;
  handlers: MessageHandlers;
}

const ICON =
  'grid size-7 place-content-center rounded-md text-n-slate-11 hover:bg-n-alpha-2 hover:text-n-slate-12';

/** Chatwoot message context menu, as a hover toolbar next to the bubble. */
export function MessageActions({ message: m, outgoing, myReaction, handlers }: Props) {
  const [confirm, setConfirm] = useState(false),
    [copied, setCopied] = useState(false);
  const deleted = Boolean(m.content_attributes.deleted);
  if (deleted) return null;
  const copy = () =>
    void navigator.clipboard
      ?.writeText(m.content || '')
      .then(() => setCopied(true))
      .catch(() => {});
  return (
    <>
      <div
        role="toolbar"
        aria-label="Ações da mensagem"
        className={cn(
          'flex items-center gap-0.5 self-center rounded-lg border border-n-weak bg-n-solid-1 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100',
          outgoing ? 'mr-1' : 'ml-1',
        )}
      >
        <button
          type="button"
          aria-label="Responder"
          title="Responder"
          className={ICON}
          onClick={() => handlers.onReply(m)}
        >
          <Reply size={15} />
        </button>
        {!m.private && (
          <Dropdown
            align={outgoing ? 'end' : 'start'}
            placement="top"
            className="flex min-w-0 grid-flow-col"
            trigger={({ toggle }) => (
              <button type="button" aria-label="Reagir" title="Reagir" className={ICON} onClick={toggle}>
                <SmilePlus size={15} />
              </button>
            )}
          >
            {(close) =>
              QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={emoji}
                  aria-pressed={myReaction === emoji}
                  onClick={() => {
                    handlers.onReact(m, myReaction === emoji ? '' : emoji);
                    close();
                  }}
                  className={cn(
                    'grid size-8 place-content-center rounded-lg text-lg hover:bg-n-alpha-2',
                    myReaction === emoji && 'bg-n-brand/15',
                  )}
                >
                  {emoji}
                </button>
              ))
            }
          </Dropdown>
        )}
        {m.content && (
          <button
            type="button"
            aria-label={copied ? 'Texto copiado' : 'Copiar texto'}
            title="Copiar texto"
            className={ICON}
            onClick={copy}
            onMouseLeave={() => setCopied(false)}
          >
            <Copy size={15} />
          </button>
        )}
        {m.message_type === 'outgoing' && (
          <button
            type="button"
            aria-label="Apagar"
            title="Apagar"
            className={ICON}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {confirm && (
        <Modal
          title="Apagar mensagem?"
          description={
            m.private
              ? 'A nota privada será removida da conversa.'
              : 'A mensagem será apagada para todos, inclusive no WhatsApp do contato.'
          }
          onClose={() => setConfirm(false)}
        >
          <div className="flex justify-end gap-2">
            <Button color="slate" variant="faded" label="Cancelar" onClick={() => setConfirm(false)} />
            <Button
              color="ruby"
              label="Apagar"
              onClick={() => {
                setConfirm(false);
                handlers.onDelete(m);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
