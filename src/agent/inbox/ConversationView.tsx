import { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, ArrowLeft, Bot, CheckCircle2, History, RotateCcw } from 'lucide-react';
import { http, query, type Realtime } from '../api';
import type { Catalog, Conversation, ConversationStatus, HistoryMessage, Message, User } from '../types';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { DetailsPanel } from './DetailsPanel';

interface Props {
  displayId: number;
  user: User;
  catalog: Catalog;
  realtime: Realtime;
  onBack: () => void;
}

const upsert = (list: Message[], message: Message) =>
  list.some((m) => m.id === message.id)
    ? list.map((m) => (m.id === message.id ? message : m))
    : [...list, message].sort((a, b) => a.id - b.id);

export function ConversationView({ displayId, user, catalog, realtime, onBack }: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [older, setOlder] = useState(true),
    [history, setHistory] = useState<HistoryMessage[] | null>(null),
    [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const path = `/conversations/${displayId}`;

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

  async function loadOlder() {
    const list = await http<Message[]>(`${path}/messages${query({ before: messages[0]?.id })}`);
    setMessages((current) => [...list, ...current]);
    setOlder(list.length === 50);
  }
  async function loadHistory() {
    const first = history?.[0];
    const list = await http<HistoryMessage[]>(
      `${path}/history${query({ before: first?.ts, before_id: first?.id, limit: 30 })}`,
    );
    setHistory((current) => [...list, ...(current || [])]);
  }
  async function act<T>(run: () => Promise<T>) {
    try {
      setError('');
      return await run();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const setStatus = (status: ConversationStatus, snoozed_until?: number) =>
    act(async () =>
      setConversation(await http<Conversation>(`${path}/toggle_status`, 'POST', { status, snoozed_until })),
    );
  const snooze = (hours: number) => setStatus('snoozed', Math.floor(Date.now() / 1000) + hours * 3600);

  if (!conversation) return <div className="conversation-empty">{error || 'Carregando…'}</div>;
  const title = conversation.contact_name || conversation.contact_phone || 'Contato';
  return (
    <div className="conversation">
      <section className="thread">
        <header className="thread-header">
          <button className="icon-btn back" onClick={onBack} aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
          <div className="thread-title">
            <strong>{title}</strong>
            <small>
              #{conversation.display_id} · {conversation.inbox_name}
              {conversation.status === 'pending' && (
                <span className="tag bot">
                  <Bot size={12} /> com a IA
                </span>
              )}
            </small>
          </div>
          <div className="thread-actions">
            {conversation.status === 'open' ? (
              <>
                <button className="btn ghost small" onClick={() => void snooze(1)} title="Adiar por 1 hora">
                  <AlarmClock size={15} /> 1h
                </button>
                <button className="btn ghost small" onClick={() => void snooze(24)} title="Adiar até amanhã">
                  <AlarmClock size={15} /> 24h
                </button>
                <button className="btn primary small" onClick={() => void setStatus('resolved')}>
                  <CheckCircle2 size={15} /> Resolver
                </button>
              </>
            ) : (
              <button className="btn primary small" onClick={() => void setStatus('open')}>
                <RotateCcw size={15} /> {conversation.status === 'pending' ? 'Assumir da IA' : 'Reabrir'}
              </button>
            )}
          </div>
        </header>
        {error && <div className="form-error pad">{error}</div>}
        <div className="messages">
          <div className="history-actions">
            {older && (
              <button className="btn ghost small" onClick={() => void act(loadOlder)}>
                Mensagens anteriores
              </button>
            )}
            <button className="btn ghost small" onClick={() => void act(loadHistory)}>
              <History size={14} /> Histórico do WhatsApp
            </button>
          </div>
          {history && (
            <div className="wa-history" aria-label="Histórico anterior do WhatsApp">
              {history.length === 0 && <p className="muted">Sem histórico anterior sincronizado.</p>}
              {history.map((h) => (
                <div key={h.id} className={`history-line ${h.from_me ? 'mine' : ''}`}>
                  <span>{h.body}</span>
                  <small>{new Date(h.ts * 1000).toLocaleString('pt-BR')}</small>
                </div>
              ))}
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <div ref={bottom} />
        </div>
        <Composer
          path={path}
          onSent={(m) => setMessages((list) => upsert(list, m))}
          disabled={conversation.status === 'resolved'}
        />
      </section>
      <DetailsPanel
        conversation={conversation}
        user={user}
        catalog={catalog}
        onChange={setConversation}
        onError={setError}
      />
    </div>
  );
}
