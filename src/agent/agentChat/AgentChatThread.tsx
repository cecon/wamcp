import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, Lightbulb, SendHorizontal, Wrench } from 'lucide-react';
import { http } from '../api';
import { MemberAvatar } from '../settings/members/MemberAvatar';
import { MessageBody } from '../conversations/MessageBody';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatSessionBar } from './ChatSessionBar';
import { chatTime, type ChatAgent, type ChatMessage, type ChatSessions, type ChatStep } from './types';

interface Props {
  agent: ChatAgent;
  messages: ChatMessage[];
  /** What the agent is doing on its answer, newest last. */
  steps: ChatStep[];
  sessions: ChatSessions | null;
  /** The session on screen (an earlier one is read only). */
  viewing: number;
  onView: (session: number) => void;
  onNewSession: () => Promise<void>;
  starting: boolean;
  error: string;
  onSent: (message: ChatMessage) => void;
  onBack: () => void;
}

/** Newest steps shown while the agent works (older ones scroll away). */
const SHOWN_STEPS = 6;

/** The chat with one agent: the messages, what the agent is doing while the answer is on its way, and
 * the composer; an earlier session is read only and a session out of tokens asks for a new one. */
export function AgentChatThread(props: Props) {
  const { agent, messages, steps, sessions, viewing, onView, onNewSession, starting, error, onSent, onBack } =
    props;
  const [draft, setDraft] = useState(''),
    [sending, setSending] = useState(false),
    [sendError, setSendError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const past = sessions !== null && viewing !== sessions.current;
  const full = sessions?.sessions.find((s) => s.number === sessions.current)?.full ?? false;
  const waiting = !past && messages.at(-1)?.role === 'user';
  const startNew = () => {
    setSendError('');
    onNewSession().catch((e: Error) => setSendError(e.message));
  };
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, waiting, steps.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError('');
    try {
      onSent(await http<ChatMessage>(`/agent_chats/${agent.id}/messages`, 'POST', { content }));
      setDraft('');
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversa com ${agent.name}`}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-n-weak px-4">
        <Button
          color="slate"
          variant="ghost"
          icon={ArrowLeft}
          aria-label="Voltar"
          onClick={onBack}
          className="md:hidden"
        />
        <MemberAvatar choices={agent.avatar} kind="ai" seed={agent.id} size={32} title={agent.name} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-n-slate-12">{agent.name}</h2>
          <p className="truncate text-xs text-n-slate-11">
            {agent.system
              ? 'Ajuda você a montar o app: muda algo só depois da sua aprovação'
              : [agent.profile_name, agent.model].filter(Boolean).join(' · ') || 'Agente de IA'}
          </p>
        </div>
        <ChatSessionBar
          sessions={sessions}
          viewing={viewing}
          onView={onView}
          onNew={startNew}
          busy={starting}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && <p className="text-sm text-n-ruby-11">{error}</p>}
        {!error && messages.length === 0 && (
          <p className="mx-auto mt-10 max-w-sm text-center text-sm text-n-slate-11">
            {agent.description || `Escreva para ${agent.name}.`} Esta conversa é só sua: não vai para o
            WhatsApp e ninguém mais da equipe vê.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end pl-10' : 'pr-10')}>
              <div
                className={cn(
                  'max-w-lg min-w-0 rounded-xl px-4 py-3 text-sm text-n-slate-12',
                  m.role === 'user' && 'rounded-br-sm bg-n-solid-blue',
                  m.role === 'agent' && 'rounded-bl-sm bg-n-solid-iris',
                  m.role === 'error' && 'rounded-bl-sm bg-n-ruby-4 text-n-ruby-12',
                )}
              >
                {m.role === 'error' && (
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium">
                    <CircleAlert size={12} /> Sem resposta
                  </p>
                )}
                {m.role === 'user' ? (
                  <MessageBody content={m.content} />
                ) : (
                  <ChatMarkdown content={m.content} />
                )}
                <p className="mt-2 text-right text-xs text-n-slate-10">{chatTime(m.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
        {waiting && (
          <div className="mt-2 flex items-end gap-2 pr-10" role="status">
            <MemberAvatar choices={agent.avatar} kind="ai" seed={agent.id} size={24} title={agent.name} />
            <div className="flex max-w-lg min-w-0 flex-col gap-2 rounded-xl rounded-bl-sm bg-n-solid-iris px-4 py-3">
              {steps.length > 0 && (
                <ol aria-label={`O que ${agent.name} está fazendo`} className="flex flex-col gap-1.5">
                  {steps.slice(-SHOWN_STEPS).map((s, i, shown) => (
                    <li
                      key={steps.length - shown.length + i}
                      className={cn(
                        'flex gap-2 text-xs text-n-slate-11 transition-opacity',
                        i < shown.length - 1 && 'opacity-60',
                      )}
                    >
                      {s.kind === 'tool' ? (
                        <Wrench size={12} className="mt-0.5 shrink-0" aria-hidden />
                      ) : (
                        <Lightbulb size={12} className="mt-0.5 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 break-words whitespace-pre-wrap">
                        {s.kind === 'tool' ? `Usando ${s.text}` : s.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <span className="flex h-4 items-center gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-2 animate-bounce rounded-full bg-n-iris-9"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
            <span className="shrink-0 animate-pulse text-xs text-n-slate-11">
              {agent.name} está pensando…
            </span>
          </div>
        )}
        <div ref={end} />
      </div>
      {(past || full) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-n-weak bg-n-alpha-1 px-4 py-3 text-sm text-n-slate-11">
          <span>
            {past
              ? 'Esta conversa foi encerrada: você pode ler, mas não responder.'
              : `Esta conversa chegou ao limite de tokens. Comece uma nova para continuar com ${agent.name}.`}
          </span>
          {past ? (
            <Button
              color="slate"
              variant="faded"
              label="Voltar para a conversa atual"
              onClick={() => onView(sessions.current)}
            />
          ) : (
            <Button label="Nova conversa" disabled={starting} onClick={startNew} />
          )}
        </div>
      )}
      <form
        hidden={past}
        className="flex shrink-0 items-end gap-2 border-t border-n-weak p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="field max-h-40 min-h-10 flex-1 resize-none"
          aria-label={`Mensagem para ${agent.name}`}
          placeholder={`Mensagem para ${agent.name}`}
          rows={1}
          disabled={full}
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="submit"
          size="md"
          icon={SendHorizontal}
          aria-label="Enviar"
          disabled={sending || full || !draft.trim()}
        />
      </form>
      {sendError && <p className="px-3 pb-2 text-sm text-n-ruby-11">{sendError}</p>}
    </section>
  );
}
