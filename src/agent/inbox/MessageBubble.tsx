import { AlertCircle, Check, CheckCheck, Clock, Lock } from 'lucide-react';
import { formatTime } from '../api';
import type { Message } from '../types';

function Delivery({ message }: { message: Message }) {
  switch (message.status) {
    case 'pending':
      return <Clock size={13} aria-label="Enviando" />;
    case 'sent':
      return <Check size={13} aria-label="Enviada" />;
    case 'delivered':
      return <CheckCheck size={13} aria-label="Entregue" />;
    case 'read':
      return <CheckCheck size={13} className="read" aria-label="Lida" />;
    default:
      return (
        <span className="failed" title={message.content_attributes.external_error || 'Falha no envio'}>
          <AlertCircle size={13} /> não enviada
        </span>
      );
  }
}

export function MessageBubble({ message }: { message: Message }) {
  if (message.message_type === 'activity')
    return (
      <div className="activity">
        <span>{message.content}</span>
        <small>{formatTime(message.created_at)}</small>
      </div>
    );
  const outgoing = message.message_type !== 'incoming';
  const kind = message.private ? 'note' : outgoing ? 'out' : 'in';
  // Messages typed on the phone have no agent behind them.
  const phone = message.sender_type === 'system' ? 'Pelo celular' : '';
  const sender = outgoing ? message.sender_name || message.content_attributes.automated || phone : '';
  return (
    <div className={`bubble-row ${outgoing ? 'right' : 'left'}`}>
      <div className={`bubble ${kind}`}>
        {sender && (
          <span className="sender">
            {message.private && <Lock size={11} />}
            {sender}
            {message.private && ' · nota interna'}
          </span>
        )}
        <p>{message.content}</p>
        <span className="bubble-meta">
          {formatTime(message.created_at)}
          {outgoing && !message.private && <Delivery message={message} />}
        </span>
      </div>
    </div>
  );
}
