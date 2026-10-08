import { useState } from 'react';
import { MessageCircle, Search } from 'lucide-react';
import { http, initials, query } from '../../api';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { HistoryMessages } from './HistoryMessages';
import { sessionPath, type HistoryChat, type HistoryMessage } from './model';

const chatName = (chat: Pick<HistoryChat, 'jid' | 'name'> | undefined, jid: string) =>
  chat?.name || jid.split('@')[0];

/** Histórico tab: the local WhatsApp mirror (chats, messages with pagination, full-text search). */
export function HistoryViewer({ id }: { id: string }) {
  const base = sessionPath(id);
  const [q, setQ] = useState(''),
    [term, setTerm] = useState(''),
    [results, setResults] = useState<HistoryMessage[] | null>(null),
    [jid, setJid] = useState(''),
    [searchError, setSearchError] = useState('');
  const { data: chats, error } = useFetch<HistoryChat[]>(`${base}/chats${query({ q })}`);
  async function search() {
    setSearchError('');
    try {
      setResults(await http<HistoryMessage[]>(`${base}/search${query({ q: term.trim() })}`));
    } catch (e) {
      setSearchError((e as Error).message);
    }
  }
  const list = chats || [];
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          className="field"
          value={term}
          maxLength={200}
          placeholder="Buscar em todas as mensagens"
          aria-label="Buscar em todas as mensagens"
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button type="submit" size="md" color="slate" icon={Search} label="Buscar" disabled={!term.trim()} />
      </form>
      {(error || searchError) && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error || searchError}
        </p>
      )}
      {results && (
        <section aria-label="Resultados da busca" className="rounded-xl border border-n-weak">
          <div className="flex items-center justify-between border-b border-n-weak px-4 py-2">
            <span className="text-sm text-n-slate-11">
              {results.length} {results.length === 1 ? 'mensagem encontrada' : 'mensagens encontradas'}
            </span>
            <Button color="slate" variant="link" label="Limpar busca" onClick={() => setResults(null)} />
          </div>
          <ul className="max-h-64 divide-y divide-n-weak overflow-y-auto">
            {results.map((m) => (
              <li key={`${m.jid}-${m.id}`}>
                <button
                  type="button"
                  className="w-full px-4 py-2 text-left hover:bg-n-alpha-2"
                  onClick={() => setJid(m.jid)}
                >
                  <span className="block text-xs text-n-slate-11">
                    {chatName(
                      list.find((c) => c.jid === m.jid),
                      m.jid,
                    )}{' '}
                    · {new Date(m.ts * 1000).toLocaleString('pt-BR')}
                  </span>
                  <span className="block truncate text-sm text-n-slate-12">{m.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid min-h-[28rem] overflow-hidden rounded-xl border border-n-weak md:grid-cols-[18rem_1fr]">
        <div className="flex min-h-0 flex-col border-b border-n-weak md:border-r md:border-b-0">
          <label className="relative m-3">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-n-slate-10" />
            <input
              className="field !h-8 pl-8"
              value={q}
              placeholder="Buscar conversa"
              aria-label="Buscar conversa"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <ul className="max-h-[28rem] min-h-0 flex-1 overflow-y-auto" aria-label="Conversas do WhatsApp">
            {chats && list.length === 0 && (
              <li className="px-4 py-6 text-sm text-n-slate-11">
                Nenhuma conversa. Conecte o WhatsApp e aguarde a sincronização.
              </li>
            )}
            {list.map((c) => (
              <li key={c.jid}>
                <button
                  type="button"
                  aria-current={jid === c.jid ? 'true' : undefined}
                  onClick={() => setJid(c.jid)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-n-alpha-2',
                    jid === c.jid && 'bg-n-alpha-2',
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-n-slate-4 text-xs font-medium">
                    {initials(chatName(c, c.jid))}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-n-slate-12">
                      {chatName(c, c.jid)}
                    </span>
                    <span className="block truncate text-xs text-n-slate-11">
                      {c.preview || 'Sem mensagens'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {jid ? (
          <HistoryMessages
            key={jid}
            base={base}
            jid={jid}
            title={chatName(
              list.find((c) => c.jid === jid),
              jid,
            )}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <MessageCircle size={36} className="text-n-slate-9" />
            <p className="text-heading-3 text-n-slate-12">Histórico do WhatsApp</p>
            <p className="text-sm text-n-slate-11">Selecione uma conversa para ver as mensagens.</p>
          </div>
        )}
      </div>
    </div>
  );
}
