import { AlertCircle, Check, CheckCheck, Clock, LockKeyhole } from 'lucide-react';
import type { Message } from '../types';
import { Avatar } from '../ui/Avatar';
import { cn } from '../ui/cn';

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

/** Chatwoot components-next/message: activity pill, incoming left, outgoing right with avatar. */
export function MessageItem({ message: m }: { message: Message }) {
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
  const outgoing = m.message_type !== 'incoming';
  const failed = m.status === 'failed';
  const author =
    m.sender_name ||
    m.content_attributes.automated ||
    (m.sender_type === 'system' ? 'Pelo celular' : 'Equipe');
  const bubble = m.private
    ? 'bg-n-solid-amber text-n-amber-12'
    : failed
      ? 'bg-n-ruby-4 text-n-ruby-12'
      : m.sender_type === 'agent_bot' || m.content_attributes.automated
        ? 'bg-n-solid-iris text-n-slate-12'
        : outgoing
          ? 'bg-n-solid-blue text-n-slate-12'
          : 'bg-n-slate-4 text-n-slate-12';
  return (
    <li className={cn('mb-2 flex w-full', outgoing ? 'justify-end pl-8' : 'pr-8')}>
      <div className={cn('grid gap-x-2', outgoing ? 'grid-cols-[1fr_24px]' : 'grid-cols-1')}>
        <div
          className={cn(
            'max-w-lg px-4 py-3 text-sm',
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
          <p className="break-words whitespace-pre-wrap">{m.content}</p>
          <p
            className={cn(
              'mt-2 flex items-center justify-end gap-1.5 text-xs',
              m.private ? 'text-n-amber-12/50' : 'text-n-slate-10',
            )}
          >
            {time(m.created_at)}
            {outgoing && !m.private && <Status message={m} />}
          </p>
        </div>
        {outgoing && <Avatar name={author} size={24} className="self-end" />}
      </div>
    </li>
  );
}
