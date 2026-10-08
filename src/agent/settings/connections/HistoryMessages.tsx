import { useEffect, useState } from 'react';
import { http, query } from '../../api';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import type { HistoryMessage } from './model';

const PAGE_SIZE = 50;

const page = (base: string, jid: string, before?: HistoryMessage) =>
  http<HistoryMessage[]>(
    `${base}/messages${query({ jid, limit: PAGE_SIZE, before: before?.ts, beforeId: before?.id })}`,
  );

interface Props {
  /** /sessions/{id} */
  base: string;
  jid: string;
  title: string;
}

/** Messages of one mirrored chat, oldest first; "Carregar anteriores" pages back with before/beforeId. */
export function HistoryMessages({ base, jid, title }: Props) {
  const [messages, setMessages] = useState<HistoryMessage[] | null>(null),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    page(base, jid)
      .then((loaded) => {
        if (!live) return;
        setMessages(loaded);
        setMore(loaded.length === PAGE_SIZE);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [base, jid]);
  async function older() {
    setBusy(true);
    try {
      const loaded = await page(base, jid, messages?.[0]);
      setMessages((current) => [
        ...loaded,
        ...(current || []).filter((m) => !loaded.some((l) => l.id === m.id)),
      ]);
      setMore(loaded.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flex min-h-0 flex-col" aria-label={`Mensagens de ${title}`}>
      <header className="border-b border-n-weak px-4 py-3">
        <p className="text-heading-3 text-n-slate-12">{title}</p>
        <p className="text-xs text-n-slate-11">{jid}</p>
      </header>
      <div className="flex max-h-[28rem] min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-n-surface-2 p-4">
        {error && (
          <p role="alert" className="text-sm text-n-ruby-11">
            {error}
          </p>
        )}
        {more && (
          <Button
            color="slate"
            className="self-center"
            label={busy ? 'Carregando…' : 'Carregar anteriores'}
            disabled={busy}
            onClick={() => void older()}
          />
        )}
        {messages?.length === 0 && <p className="text-sm text-n-slate-11">Nenhuma mensagem sincronizada.</p>}
        {messages?.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[75%] rounded-xl px-3 py-2 text-sm',
              m.from_me ? 'self-end bg-n-solid-blue text-n-slate-12' : 'self-start bg-n-solid-1',
            )}
          >
            {!m.from_me && m.sender && <p className="text-xs font-medium text-n-slate-11">{m.sender}</p>}
            <p className="break-words whitespace-pre-wrap text-n-slate-12">{m.body}</p>
            <time className="mt-1 block text-right text-xxs text-n-slate-10">
              {new Date(m.ts * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </time>
          </div>
        ))}
      </div>
    </section>
  );
}
