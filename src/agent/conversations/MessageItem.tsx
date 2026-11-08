// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { AlertCircle, Ban, Check, CheckCheck, Clock, LockKeyhole } from 'lucide-react';

import type { Message, Reaction } from '../types';
import { Avatar } from '../ui/Avatar';
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
  if (message.status === 'read')
    return <CheckCheck size={14} style={{ color: '#7EB6FF' }} aria-label="Lida" />;
  return (
    <Box
      component="span"
      title={message.content_attributes.external_error || 'Falha no envio'}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'error.main' }}
    >
      <AlertCircle size={14} /> não enviada
    </Box>
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

/** Balão de mensagem no C3Theme (lote 18): pílula de atividade, recebidas à esquerda e enviadas à direita. */
export function MessageItem({ message: m, quoted, handlers, currentUserId, highlighted }: Props) {
  if (m.message_type === 'activity')
    return (
      <Box component="li" sx={{ mb: 1, display: 'flex', justifyContent: 'center' }}>
        <Box
          component="span"
          title={time(m.created_at)}
          sx={{ borderRadius: 2, bgcolor: 'action.hover', px: 1.5, py: 0.5 }}
        >
          <Typography variant="body2" color="text.secondary">
            {m.content}
          </Typography>
        </Box>
      </Box>
    );
  const attrs = m.content_attributes;
  const outgoing = m.message_type !== 'incoming';
  const failed = m.status === 'failed';
  const deleted = Boolean(attrs.deleted);
  const author = authorOf(m);
  const mine = (r: Reaction) => r.sender_type === 'user' && r.sender_id === currentUserId;
  const bubble = deleted
    ? { bgcolor: 'var(--color-n-alpha-1)', color: 'text.secondary' }
    : m.private
      ? { bgcolor: 'var(--color-n-solid-amber)', color: 'var(--color-n-amber-12)' }
      : failed
        ? { bgcolor: 'var(--color-n-ruby-4)', color: 'var(--color-n-ruby-12)' }
        : m.sender_type === 'agent_bot' || attrs.automated
          ? { bgcolor: 'var(--color-n-solid-iris)', color: 'var(--color-n-slate-12)' }
          : outgoing
            ? { bgcolor: 'var(--color-n-solid-blue)', color: 'var(--color-n-slate-12)' }
            : { bgcolor: 'var(--color-n-slate-4)', color: 'var(--color-n-slate-12)' };
  const actions = handlers && (
    <MessageActions
      message={m}
      outgoing={outgoing}
      myReaction={attrs.reactions?.find(mine)?.emoji}
      handlers={handlers}
    />
  );
  return (
    <Box
      component="li"
      id={`message${m.id}`}
      className={highlighted ? 'group bg-n-alpha-1' : 'group'}
      sx={{
        mb: 1,
        display: 'flex',
        width: '100%',
        borderRadius: 1.5,
        transition: 'background-color .15s',
        justifyContent: outgoing ? 'flex-end' : 'flex-start',
        pl: outgoing ? 4 : 0,
        pr: outgoing ? 0 : 4,
        bgcolor: highlighted ? 'action.hover' : 'transparent',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'flex-end',
          justifyContent: outgoing ? 'flex-end' : 'flex-start',
          minWidth: 0,
          width: '100%',
        }}
      >
        {!outgoing && actions}
        <Stack sx={{ minWidth: 0, alignItems: outgoing ? 'flex-end' : 'flex-start' }}>
          <Box
            sx={{
              maxWidth: 512,
              minWidth: 0,
              px: 2,
              py: 1.5,
              fontSize: 14,
              borderRadius: 2,
              borderBottomRightRadius: outgoing ? 4 : undefined,
              borderBottomLeftRadius: outgoing ? undefined : 4,
              ...bubble,
            }}
          >
            {(m.private || outgoing) && (
              <Stack direction="row" spacing={0.5} sx={{ mb: 0.5, alignItems: 'center' }}>
                {m.private && <LockKeyhole size={12} />}
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 500, color: m.private ? 'var(--color-n-amber-12)' : 'text.secondary' }}
                >
                  {author}
                  {m.private && ' · nota privada'}
                </Typography>
              </Stack>
            )}
            {quoted && !deleted && <QuotedMessage message={quoted} onJump={handlers?.onJump} />}
            {deleted ? (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Ban size={14} />
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                  Esta mensagem foi apagada
                </Typography>
              </Stack>
            ) : (
              <>
                <Attachments items={m.attachments || []} />
                {m.content && <MessageBody content={m.content} />}
              </>
            )}
            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                mt: 1,
                alignItems: 'center',
                justifyContent: 'flex-end',
                color: m.private ? 'var(--color-n-amber-12)' : 'text.secondary',
              }}
            >
              {attrs.edited && !deleted && (
                <Box
                  component="span"
                  title={attrs.previous_content ? `Antes: ${attrs.previous_content}` : undefined}
                  sx={{ fontSize: 12 }}
                >
                  (editada)
                </Box>
              )}
              <Typography variant="caption" color="inherit">
                {time(m.created_at)}
              </Typography>
              {outgoing && !m.private && <Status message={m} />}
            </Stack>
          </Box>
          {!deleted && <Reactions reactions={attrs.reactions || []} outgoing={outgoing} mine={mine} />}
          {failed && outgoing && handlers && <RetryButton onRetry={() => handlers.onRetry(m)} />}
        </Stack>
        {outgoing && actions}
        {outgoing && <Avatar name={author} size={24} />}
      </Stack>
    </Box>
  );
}
