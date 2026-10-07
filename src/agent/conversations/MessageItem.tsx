import { AlertCircle, Ban, Check, CheckCheck, Clock, LockKeyhole } from 'lucide-react';
import type { Message, Reaction } from '../types';
import { Avatar } from '../ui/Avatar';
import { cn } from '../ui/cn';
import { Attachments } from './Attachments';
import { MessageActions, type MessageHandlers } from './MessageActions';
import { QuotedMessage, Reactions, RetryButton } from './MessageExtras';
import { authorOf } from './messageText';
import { MessageBody } from './MessageBody';

const time = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Status({ message }: { message: Message }) {
  if (message.status === 'pending') return <Clock size={14} aria-label="Enviando" />;
  if (message.status === 'sent') return <Check size={14} aria-label="Enviada" />;
  if (message.status === 'delivered') return <CheckCheck size={14} aria-label="Entregue" />;
  if (message.status === 'read') return <CheckCheck size={14} className="text-[#7EB6FF]" aria-label="Lida" />;
  return (
    <span
      className="flex items-center gap-1 text-n-ruby-11"
      title={message.content_attributes.external_error || 'Falha no envio'}
    >
      <AlertCircle size={14} /> não enviada
    </span>
  );
}

interface Props {
  message: Message;
  /** The loaded message this one replies to (content_attributes.in_reply_to). */
  quoted?: Message;
  /** Enables the hover actions and retry; omitted in read-only lists. */
  handlers?: MessageHandlers;
  currentUserId?: number;
  highlighted?: boolean;
}

/** Chatwoot components-next/message: activity pill, incoming left, outgoing right with avatar. */
export function MessageItem({ message: m, quoted, handlers, currentUserId, highlighted }: Props) {
  if (m.message_type === 'activity')
    return (
      <li className="mb-2 flex justify-center">
        <span
          className="rounded-xl bg-n-alpha-1 px-3 py-1 text-sm text-n-slate-11"
          title={time(m.created_at)}
        >
          {m.content}
        </span>
      </li>
    );
  const attrs = m.content_attributes;
  const outgoing = m.message_type !== 'incoming';
  const failed = m.status === 'failed';
  const deleted = Boolean(attrs.deleted);
  const author = authorOf(m);
  const mine = (r: Reaction) => r.sender_type === 'user' && r.sender_id === currentUserId;
  const bubble = deleted
    ? 'bg-n-alpha-1 text-n-slate-11'
    : m.private
      ? 'bg-n-solid-amber text-n-amber-12'
      : failed
        ? 'bg-n-ruby-4 text-n-ruby-12'
        : m.sender_type === 'agent_bot' || attrs.automated
          ? 'bg-n-solid-iris text-n-slate-12'
          : outgoing
            ? 'bg-n-solid-blue text-n-slate-12'
            : 'bg-n-slate-4 text-n-slate-12';
  const actions = handlers && (
    <MessageActions
      message={m}
      outgoing={outgoing}
      myReaction={attrs.reactions?.find(mine)?.emoji}
      handlers={handlers}
    />
  );
  return (
    <li
      id={`message${m.id}`}
      className={cn(
        'group mb-2 flex w-full rounded-lg transition-colors',
        outgoing ? 'justify-end pl-8' : 'pr-8',
        highlighted && 'bg-n-alpha-1',
      )}
    >
      <div className={cn('grid gap-x-2', outgoing ? 'grid-cols-[1fr_24px]' : 'grid-cols-1')}>
        <div className={cn('flex min-w-0', outgoing && 'justify-end')}>
          {outgoing && actions}
          <div className="flex min-w-0 flex-col">
            <div
              className={cn(
                'max-w-lg min-w-0 px-4 py-3 text-sm',
                outgoing ? 'rounded-xl rounded-br-sm' : 'rounded-xl rounded-bl-sm',
                bubble,
              )}
            >
              {(m.private || outgoing) && (
                <p
                  className={cn(
                    'mb-1 flex items-center gap-1 text-xs font-medium',
                    m.private ? 'text-n-amber-12/70' : 'text-n-slate-11',
                  )}
                >
                  {m.private && <LockKeyhole size={12} />}
                  {author}
                  {m.private && ' · nota privada'}
                </p>
              )}
              {quoted && !deleted && <QuotedMessage message={quoted} onJump={handlers?.onJump} />}
              {deleted ? (
                <p className="flex items-center gap-1.5 italic">
                  <Ban size={14} /> Esta mensagem foi apagada
                </p>
              ) : (
                <>
                  <Attachments items={m.attachments || []} />
                  {m.content && <MessageBody content={m.content} />}
                </>
              )}
              <p
                className={cn(
                  'mt-2 flex items-center justify-end gap-1.5 text-xs',
                  m.private ? 'text-n-amber-12/50' : 'text-n-slate-10',
                )}
              >
                {attrs.edited && !deleted && (
                  <span title={attrs.previous_content ? `Antes: ${attrs.previous_content}` : undefined}>
                    (editada)
                  </span>
                )}
                {time(m.created_at)}
                {outgoing && !m.private && <Status message={m} />}
              </p>
            </div>
            {!deleted && <Reactions reactions={attrs.reactions || []} outgoing={outgoing} mine={mine} />}
            {failed && outgoing && handlers && <RetryButton onRetry={() => handlers.onRetry(m)} />}
          </div>
          {!outgoing && actions}
        </div>
        {outgoing && <Avatar name={author} size={24} className="self-end" />}
      </div>
    </li>
  );
}
