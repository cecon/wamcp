import { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { http, query, type Realtime } from '../api';
import type { Catalog, Conversation, ConversationStatus, HistoryMessage, Message, User } from '../types';
import { Button } from '../ui/Button';
import { ConversationHeader } from './ConversationHeader';
import { ConversationMenu } from './ConversationMenu';
import { MessageList } from './MessageList';
import { ReplyBox } from './ReplyBox';
import { ContactPanel } from './ContactPanel';
import { TypingIndicator } from './TypingIndicator';

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

/** Chatwoot ConversationBox (header, messages, reply box) plus the contact panel on the right. */
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
        if (event.startsWith('message.') && data.conversation_id === conversation?.id) {
          setMessages((list) => upsert(list, data as unknown as Message));
          if (data.message_type === 'incoming') seen();
        } else if (data.display_id === displayId && 'status' in data && 'inbox_id' in data) {
          setConversation(data as unknown as Conversation);
        }
      }),
    [realtime, conversation?.id, displayId, seen],
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

  if (!conversation)
    return (
      <div className="flex flex-1 items-center justify-center border-l border-n-weak bg-n-surface-1 text-sm text-n-slate-11">
        {error || 'Carregando…'}
      </div>
    );
  return (
    <>
      <section
        aria-label="Conversa"
        className="flex min-w-0 flex-1 flex-col border-l border-n-weak bg-n-surface-1"
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
        {error && <p className="px-4 pt-2 text-sm text-n-ruby-11">{error}</p>}
        <div className="flex-1 overflow-y-auto pb-4">
          <div className="flex justify-center gap-2 py-3">
            {older && (
              <Button
                color="slate"
                variant="faded"
                size="xs"
                label="Mensagens anteriores"
                onClick={() => void loadOlder()}
              />
            )}
            <Button
              color="slate"
              variant="faded"
              size="xs"
              icon={History}
              label="Histórico do WhatsApp"
              onClick={() => void loadHistory()}
            />
          </div>
          {history && (
            <div
              aria-label="Histórico do WhatsApp"
              className="mx-4 mb-3 rounded-xl border border-dashed border-n-strong p-3"
            >
              {history.length === 0 && (
                <p className="text-sm text-n-slate-11">Sem histórico anterior sincronizado.</p>
              )}
              {history.map((h) => (
                <p key={h.id} className="flex justify-between gap-3 py-0.5 text-xs text-n-slate-11">
                  <span className={h.from_me ? 'text-n-blue-11' : 'text-n-slate-12'}>{h.body}</span>
                  <span className="shrink-0">{new Date(h.ts * 1000).toLocaleString('pt-BR')}</span>
                </p>
              ))}
            </div>
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
        </div>
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
      </section>
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
