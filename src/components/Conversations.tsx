import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, sessionPath } from '../api';
import type { Chat, Message } from '../types';
import { Empty } from '../ui';
export function Conversations({ id }: { id: string }) {
  const [chats, setChats] = useState<Chat[]>([]),
    [jid, setJid] = useState(''),
    [messages, setMessages] = useState<Message[]>([]),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<Chat[]>(`${sessionPath(id)}/chats?q=${encodeURIComponent(query)}`);
        if (!cancelled) setChats(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, query]);
  useEffect(() => {
    let cancelled = false;
    if (!jid) return;
    async function load() {
      try {
        const data = await api<Message[]>(`${sessionPath(id)}/messages?jid=${encodeURIComponent(jid)}`);
        if (!cancelled)
          setMessages((current) =>
            [...current.filter((m) => !data.some((d) => d.id === m.id)), ...data].sort((a, b) => a.ts - b.ts),
          );
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, jid]);
  async function older() {
    setLoading(true);
    try {
      const data = await api<Message[]>(
        `${sessionPath(id)}/messages?jid=${encodeURIComponent(jid)}&before=${messages[0]?.ts || Number.MAX_SAFE_INTEGER}&beforeId=${encodeURIComponent(messages[0]?.id || '')}`,
      );
      setMessages((current) => [...data, ...current.filter((m) => !data.some((d) => d.id === m.id))]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <div className="chat-layout">
        <div className="chat-list">
          <div className="search">
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conversa" />
          </div>
          {chats.length ? (
            chats.map((c) => (
              <button
                className={`chat-item ${jid === c.jid ? 'active' : ''}`}
                key={c.jid}
                onClick={() => {
                  setMessages([]);
                  setJid(c.jid);
                }}
              >
                <span className="avatar">{(c.name || c.jid)[0].toUpperCase()}</span>
                <div>
                  <strong>{c.name || c.jid.split('@')[0]}</strong>
                  <p>{c.preview || 'Sem mensagens'}</p>
                </div>
              </button>
            ))
          ) : (
            <Empty title="Nenhuma conversa" detail="Conecte a sessão e aguarde a sincronização." />
          )}
        </div>
        <div className="chat-history">
          {jid ? (
            <>
              <div className="chat-title">
                <strong>{chats.find((c) => c.jid === jid)?.name || jid.split('@')[0]}</strong>
                <small>{jid}</small>
              </div>
              <div className="messages">
                {messages.length >= 100 && (
                  <button className="secondary older" disabled={loading} onClick={() => void older()}>
                    Carregar anteriores
                  </button>
                )}
                {messages.map((m) => (
                  <div className={`bubble ${m.from_me ? 'mine' : ''}`} key={m.id}>
                    {!m.from_me && <small className="sender">{m.sender}</small>}
                    <p>{m.body}</p>
                    <time>
                      {new Date(m.ts * 1000).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </time>
                  </div>
                ))}
              </div>
              <div className="history-note">Histórico sincronizado • Mídias identificadas por tipo</div>
            </>
          ) : (
            <Empty
              title="Suas conversas, em um só lugar"
              detail="Selecione uma conversa para explorar o histórico."
            />
          )}
        </div>
      </div>
    </>
  );
}
