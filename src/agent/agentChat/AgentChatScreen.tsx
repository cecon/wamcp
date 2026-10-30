import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { http, REALTIME_RECONNECTED, type Realtime } from '../api';
import { useFetch } from '../useFetch';
import { MemberAvatar } from '../settings/members/MemberAvatar';
import { cn } from '../ui/cn';
import { AgentChatThread } from './AgentChatThread';
import {
  chatTime,
  plainText,
  type ChatAgent,
  type ChatMessage,
  type ChatSessions,
  type ChatStep,
} from './types';

interface Props {
  agentId?: number;
  realtime?: Realtime;
  /** Opens an agent's chat (`undefined`: back to the list on small screens). */
  onSelect: (agentId?: number) => void;
}

const CHECK_MS = 5000;

const preview = (m: ChatMessage | null) =>
  !m ? 'Comece uma conversa' : m.role === 'user' ? `Você: ${m.content}` : plainText(m.content);

/** Agentes: the person's private chats with AI agents, inside the app (not WhatsApp, not customers). */
export function AgentChatScreen({ agentId, realtime, onSelect }: Props) {
  const agents = useFetch<ChatAgent[]>('/agent_chats');
  const list = agents.data || [];
  const agent = list.find((a) => a.id === agentId);
  // What each agent is doing on its answer (`agent_chat.progress`), until the answer arrives.
  const [steps, setSteps] = useState<{ agentId: number; step: ChatStep }[]>([]);
  const sessions = useFetch<ChatSessions>(agent ? `/agent_chats/${agent.id}/sessions` : null);
  // The session on screen: the one the person picked in this agent's history, else the open one.
  const [picked, setPicked] = useState<{ agentId: number; session: number } | null>(null);
  const chosen = picked && picked.agentId === agentId ? picked.session : undefined;
  const current = sessions.data?.current;
  const shown = chosen ?? current;
  const thread = useFetch<ChatMessage[]>(
    agent ? `/agent_chats/${agent.id}/messages${chosen === undefined ? '' : `?session=${chosen}`}` : null,
  );
  // Messages sent or received since the thread was fetched; shown with it, each once and in order.
  const [live, setLive] = useState<ChatMessage[]>([]);
  const messages = useMemo(() => {
    const all = [...(thread.data || []), ...live].filter(
      (m) => m.agent_id === agentId && (shown === undefined || m.session === shown),
    );
    return all.filter((m, i) => all.findIndex((n) => n.id === m.id) === i).sort((a, b) => a.id - b.id);
  }, [thread.data, live, agentId, shown]);
  const [starting, setStarting] = useState(false);
  const startSession = async () => {
    if (!agent || starting) return;
    setStarting(true);
    try {
      const opened = await http<ChatSessions>(`/agent_chats/${agent.id}/sessions`, 'POST', {});
      setPicked({ agentId: agent.id, session: opened.current });
      setSteps((list) => list.filter((s) => s.agentId !== agent.id));
      sessions.reload();
      agents.reload();
    } finally {
      setStarting(false);
    }
  };

  const { reload } = agents,
    reloadThread = thread.reload,
    reloadSessions = sessions.reload;
  useEffect(
    () =>
      realtime?.subscribe(({ event, data }) => {
        if (event === REALTIME_RECONNECTED) {
          reload();
          reloadThread();
          reloadSessions();
        }
        if (event === 'agent_chat.progress') {
          const step = { agentId: data.agent_id as number, step: data.step as unknown as ChatStep };
          setSteps((current) => [...current, step]);
          return;
        }
        if (event !== 'agent_chat.message') return;
        const message = data as unknown as ChatMessage;
        setLive((current) => [...current, message]);
        if (message.role !== 'user')
          setSteps((current) => current.filter((s) => s.agentId !== message.agent_id));
        reload();
        reloadSessions();
      }),
    [realtime, reload, reloadThread, reloadSessions],
  );
  // While the agent is answering, look again now and then in case its event never arrives.
  const past = shown !== undefined && current !== undefined && shown !== current;
  const waiting = !past && messages.at(-1)?.role === 'user';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      reload();
      reloadThread();
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, reload, reloadThread]);

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        className={cn(
          'flex w-full shrink-0 flex-col border-r border-n-weak md:w-80',
          agent && 'hidden md:flex',
        )}
      >
        <header className="flex h-14 shrink-0 items-center px-4">
          <h1 className="text-lg font-medium text-n-slate-12">Agentes</h1>
        </header>
        {agents.error && <p className="px-4 text-sm text-n-ruby-11">{agents.error}</p>}
        {agents.data && list.length === 0 && (
          <p className="px-4 text-sm text-n-slate-11">
            Nenhum agente de IA ativo. Cadastre um em Configurações → Funcionários.
          </p>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-current={a.id === agentId}
                onClick={() => onSelect(a.id)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-n-weak px-4 py-3 text-left hover:bg-n-alpha-1',
                  a.id === agentId && 'bg-n-alpha-2',
                )}
              >
                <MemberAvatar choices={a.avatar} kind="ai" seed={a.id} size={40} title={a.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-n-slate-12">{a.name}</span>
                    {a.last && (
                      <span className="shrink-0 text-xs text-n-slate-10">{chatTime(a.last.created_at)}</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-n-slate-11">
                    {a.system ? 'Sistema · ' : ''}
                    {preview(a.last)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {agent ? (
        <AgentChatThread
          agent={agent}
          messages={messages}
          steps={steps.filter((s) => s.agentId === agent.id).map((s) => s.step)}
          sessions={sessions.data}
          viewing={shown ?? 0}
          onView={(session) => setPicked({ agentId: agent.id, session })}
          onNewSession={startSession}
          starting={starting}
          error={thread.error}
          onSent={(m) => setLive((current) => [...current, m])}
          onBack={() => onSelect(undefined)}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-center md:flex">
          <Bot size={32} className="text-n-slate-10" />
          <p className="text-base font-medium text-n-slate-12">Converse com um agente</p>
          <p className="max-w-sm text-sm text-n-slate-11">
            Peça ajuda aos seus agentes de IA aqui dentro do app. Só você vê as suas conversas.
          </p>
        </div>
      )}
    </div>
  );
}
