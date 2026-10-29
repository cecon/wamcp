import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, SendHorizontal } from 'lucide-react';
import { http } from '../api';
import { MemberAvatar } from '../settings/members/MemberAvatar';
import { MessageBody } from '../conversations/MessageBody';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { chatTime, type ChatAgent, type ChatMessage } from './types';

interface Props {
  agent: ChatAgent;
  messages: ChatMessage[];
  error: string;
  onSent: (message: ChatMessage) => void;
  onBack: () => void;
}

/** The chat with one agent: the messages, a "thinking" line while the answer is on its way, and the composer. */
export function AgentChatThread({ agent, messages, error, onSent, onBack }: Props) {
  const [draft, setDraft] = useState(''),
    [sending, setSending] = useState(false),
    [sendError, setSendError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const waiting = messages.at(-1)?.role === 'user';
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, waiting]);

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
                <MessageBody content={m.content} />
                <p className="mt-2 text-right text-xs text-n-slate-10">{chatTime(m.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
        {waiting && (
          <p className="mt-2 text-sm text-n-slate-11" role="status">
            {agent.name} está pensando…
          </p>
        )}
        <div ref={end} />
      </div>
      <form
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
          disabled={sending || !draft.trim()}
        />
      </form>
      {sendError && <p className="px-3 pb-2 text-sm text-n-ruby-11">{sendError}</p>}
    </section>
  );
}
