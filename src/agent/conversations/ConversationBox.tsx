import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { History } from 'lucide-react';

import { http, query, REALTIME_RECONNECTED, type Realtime } from '../api';
import type { Catalog, Conversation, ConversationStatus, HistoryMessage, Message, User } from '../types';
import { ConversationHeader } from './ConversationHeader';
import { ConversationMenu } from './ConversationMenu';
import { MessageList } from './MessageList';
import { ReplyBox } from './ReplyBox';
import { ContactPanel } from './ContactPanel';
import { TypingIndicator } from './TypingIndicator';
import { useConversationShortcuts } from './useConversationShortcuts';

// Frente de chat da adoção: o thread do @c3theme/chat entra em chunk próprio e só com ?c3chat.
const C3Thread = lazy(() => import('../chat/C3Thread').then((module) => ({ default: module.C3Thread })));

interface Props {
  displayId: number;
  user: User;
  catalog: Catalog;
  realtime: Realtime;
  onBack: () => void;
  onOpen: (displayId: number) => void;
  onDeleted?: () => void;
}

const upsert = (list: Message[], message: Message) =>
  list.some((m) => m.id === message.id)
    ? list.map((m) => (m.id === message.id ? message : m))
    : [...list, message].sort((a, b) => a.id - b.id);

/** Thread da conversa no C3Theme (lote 17): cabeçalho, mensagens, compositor e painel do contato. */
export function ConversationBox({
  displayId,
  user,
  catalog,
  realtime,
  onBack,
  onOpen,
  onDeleted = onBack,
}: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [older, setOlder] = useState(false),
    [history, setHistory] = useState<HistoryMessage[] | null>(null),
    [panel, setPanel] = useState(true),
    [replyTo, setReplyTo] = useState<Message | null>(null),
    [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const path = `/conversations/${displayId}`;
  const c3Chat = new URLSearchParams(window.location.search).has('c3chat');

  const upsertOne = useCallback((m: Message) => setMessages((list) => upsert(list, m)), []);
  const seen = useCallback(() => void http(`${path}/update_last_seen`, 'POST').catch(() => {}), [path]);
  useEffect(() => {
    Promise.all([http<Conversation>(path), http<Message[]>(`${path}/messages`)])
      .then(([c, list]) => {
        setConversation(c);
        setMessages(list);
        setOlder(list.length === 50);
        seen();
      })
      .catch((e: Error) => setError(e.message));
  }, [path, seen]);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise here, which React would treat as a cleanup.
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  useEffect(
    () =>
      realtime.subscribe(({ event, data }) => {
        if (event === REALTIME_RECONNECTED)
          void http<Message[]>(`${path}/messages`)
            .then(setMessages)
            .catch(() => {});
        else if (event.startsWith('message.') && data.conversation_id === conversation?.id) {
          setMessages((list) => upsert(list, data as unknown as Message));
          if (data.message_type === 'incoming') seen();
        } else if (data.display_id === displayId && 'status' in data && 'inbox_id' in data) {
          setConversation(data as unknown as Conversation);
        }
      }),
    [realtime, conversation?.id, displayId, seen, path],
  );

  async function act(run: () => Promise<unknown>) {
    try {
      setError('');
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const setStatus = (status: ConversationStatus, snoozed_until?: number) =>
    act(async () =>
      setConversation(await http<Conversation>(`${path}/toggle_status`, 'POST', { status, snoozed_until })),
    );
  const loadOlder = () =>
    act(async () => {
      const list = await http<Message[]>(`${path}/messages${query({ before: messages[0]?.id })}`);
      setMessages((current) => [...list, ...current]);
      setOlder(list.length === 50);
    });
  const loadHistory = () =>
    act(async () => {
      const first = history?.[0];
      const list = await http<HistoryMessage[]>(
        `${path}/history${query({ before: first?.ts, before_id: first?.id, limit: 30 })}`,
      );
      setHistory((current) => [...list, ...(current || [])]);
    });
  useConversationShortcuts({
    conversation,
    onStatus: (status) => void setStatus(status),
    onAssignToMe: () =>
      void act(async () =>
        setConversation(await http<Conversation>(`${path}/assignments`, 'POST', { assignee_id: user.id })),
      ),
    onShowPanel: () => setPanel(true),
  });

  if (!conversation)
    return (
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          borderLeft: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {error || 'Carregando…'}
        </Typography>
      </Box>
    );
  return (
    <>
      <Box
        component="section"
        aria-label="Conversa"
        sx={{
          display: 'flex',
          minWidth: 0,
          flex: 1,
          flexDirection: 'column',
          borderLeft: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <ConversationHeader
          conversation={conversation}
          panelOpen={panel}
          onBack={onBack}
          onTogglePanel={() => setPanel((v) => !v)}
          onStatus={(status, until) => void setStatus(status, until)}
          menu={
            <ConversationMenu
              conversation={conversation}
              isAdmin={user.role === 'administrator'}
              onChange={setConversation}
              onError={setError}
              onLeave={onBack}
              onDeleted={onDeleted}
            />
          }
        />
        {error && (
          <Typography variant="body2" sx={{ px: 2, pt: 1, color: 'error.main' }}>
            {error}
          </Typography>
        )}
        {c3Chat ? (
          <Suspense
            fallback={
              <Box sx={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Carregando conversa…
                </Typography>
              </Box>
            }
          >
            <C3Thread
              displayId={displayId}
              contactName={
                conversation.contact_name || conversation.contact_phone || conversation.contact_jid
              }
              currentUserId={user.id}
              currentUserName={user.name}
              realtime={realtime}
              disabled={conversation.status === 'resolved'}
            />
          </Suspense>
        ) : (
          <>
            <Box sx={{ flex: 1, overflowY: 'auto', pb: 2 }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', py: 1.5 }}>
                {older && (
                  <Button size="small" variant="outlined" onClick={() => void loadOlder()}>
                    Mensagens anteriores
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<History size={14} />}
                  onClick={() => void loadHistory()}
                >
                  Histórico do WhatsApp
                </Button>
              </Stack>
              {history && (
                <Box
                  aria-label="Histórico do WhatsApp"
                  sx={{
                    mx: 2,
                    mb: 1.5,
                    borderRadius: 2,
                    border: 1,
                    borderStyle: 'dashed',
                    borderColor: 'divider',
                    p: 1.5,
                  }}
                >
                  {history.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Sem histórico anterior sincronizado.
                    </Typography>
                  )}
                  {history.map((h) => (
                    <Stack
                      key={h.id}
                      direction="row"
                      spacing={1.5}
                      sx={{ justifyContent: 'space-between', py: 0.25 }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ color: h.from_me ? 'primary.main' : 'text.primary' }}
                      >
                        {h.body}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                        {new Date(h.ts * 1000).toLocaleString('pt-BR')}
                      </Typography>
                    </Stack>
                  ))}
                </Box>
              )}
              <MessageList
                messages={messages}
                path={path}
                currentUserId={user.id}
                onUpsert={upsertOne}
                onReply={setReplyTo}
                onError={setError}
              />
              <div ref={bottom} />
            </Box>
            <TypingIndicator realtime={realtime} displayId={displayId} currentUserId={user.id} />
            <ReplyBox
              path={path}
              disabled={conversation.status === 'resolved'}
              conversation={conversation}
              user={user}
              agents={catalog.agents}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onSent={upsertOne}
            />
          </>
        )}
      </Box>
      {panel && (
        <ContactPanel
          conversation={conversation}
          user={user}
          catalog={catalog}
          onChange={setConversation}
          onError={setError}
          onOpenConversation={onOpen}
          onClose={() => setPanel(false)}
        />
      )}
    </>
  );
}
