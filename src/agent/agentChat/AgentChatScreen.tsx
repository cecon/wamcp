import { useEffect, useMemo, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Bot } from 'lucide-react';

import { http, REALTIME_RECONNECTED, type Realtime } from '../api';
import { useFetch } from '../useFetch';
import { MemberAvatar } from '../settings/members/MemberAvatar';
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

/** Agentes no C3Theme (lote 26): chats privados com os agentes de IA dentro do app. */
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
      setSteps((current) => current.filter((s) => s.agentId !== agent.id));
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
    <Box sx={{ display: 'flex', minWidth: 0, flex: 1 }}>
      <Box
        component="aside"
        sx={{
          display: agent ? { xs: 'none', md: 'flex' } : 'flex',
          width: '100%',
          flexShrink: 0,
          flexDirection: 'column',
          borderRight: 1,
          borderColor: 'divider',
          md: { width: 320 },
        }}
      >
        <Box
          component="header"
          sx={{ display: 'flex', height: 56, flexShrink: 0, alignItems: 'center', px: 2 }}
        >
          <Typography variant="h6" component="h1">
            Agentes
          </Typography>
        </Box>
        {agents.error && (
          <Typography variant="body2" sx={{ px: 2, color: 'error.main' }}>
            {agents.error}
          </Typography>
        )}
        {agents.data && list.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
            Nenhum agente de IA ativo. Cadastre um em Configurações → Funcionários.
          </Typography>
        )}
        <Box component="ul" sx={{ minHeight: 0, flex: 1, overflowY: 'auto', listStyle: 'none', m: 0, p: 0 }}>
          {list.map((a) => (
            <Box component="li" key={a.id}>
              <ButtonBase
                aria-current={a.id === agentId}
                onClick={() => onSelect(a.id)}
                sx={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  px: 2,
                  py: 1.5,
                  textAlign: 'left',
                  bgcolor: a.id === agentId ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <MemberAvatar choices={a.avatar} kind="ai" seed={a.id} size={40} title={a.name} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {a.name}
                    </Typography>
                    {a.last && (
                      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                        {chatTime(a.last.created_at)}
                      </Typography>
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {a.system ? 'Sistema · ' : ''}
                    {preview(a.last)}
                  </Typography>
                </Box>
              </ButtonBase>
            </Box>
          ))}
        </Box>
      </Box>
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
        <Stack
          spacing={1}
          sx={{
            display: { xs: 'none', md: 'flex' },
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <Bot size={32} style={{ color: 'var(--color-n-slate-10)' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            Converse com um agente
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 384 }}>
            Peça ajuda aos seus agentes de IA aqui dentro do app. Só você vê as suas conversas.
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
