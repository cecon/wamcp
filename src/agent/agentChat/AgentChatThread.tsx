import { useEffect, useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { ArrowLeft, SendHorizontal } from 'lucide-react';

import { http } from '../api';
import { MemberAvatar } from '../settings/members/MemberAvatar';
import { AgentChatMessages } from './AgentChatMessages';
import { ChatSessionBar } from './ChatSessionBar';
import { type ChatAgent, type ChatMessage, type ChatSessions, type ChatStep } from './types';

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

/** Thread com um agente no C3Theme (lote 27): mensagens, passos e composer; sessão antiga é somente leitura. */
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
    <Box
      component="section"
      aria-label={`Conversa com ${agent.name}`}
      sx={{ display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column' }}
    >
      <Stack
        component="header"
        direction="row"
        spacing={1.5}
        sx={{
          height: 56,
          flexShrink: 0,
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
        }}
      >
        <IconButton
          size="small"
          aria-label="Voltar"
          onClick={onBack}
          sx={{ display: { xs: 'inline-flex', md: 'none' } }}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <MemberAvatar choices={agent.avatar} kind="ai" seed={agent.id} size={32} title={agent.name} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
            {agent.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="p">
            {agent.system
              ? 'Ajuda você a montar o app: muda algo só depois da sua aprovação'
              : [agent.profile_name, agent.model].filter(Boolean).join(' · ') || 'Agente de IA'}
          </Typography>
        </Box>
        <ChatSessionBar
          sessions={sessions}
          viewing={viewing}
          onView={onView}
          onNew={startNew}
          busy={starting}
        />
      </Stack>
      <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
        {error && (
          <Typography variant="body2" sx={{ color: 'error.main' }}>
            {error}
          </Typography>
        )}
        {!error && messages.length === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mx: 'auto', mt: 5, maxWidth: 384, textAlign: 'center' }}
          >
            {agent.description || `Escreva para ${agent.name}.`} Esta conversa é só sua: não vai para o
            WhatsApp e ninguém mais da equipe vê.
          </Typography>
        )}
        <AgentChatMessages agent={agent} messages={messages} steps={steps} waiting={waiting} />
        <div ref={end} />
      </Box>
      {(past || full) && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            flexShrink: 0,
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            px: 2,
            py: 1.5,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {past
              ? 'Esta conversa foi encerrada: você pode ler, mas não responder.'
              : `Esta conversa chegou ao limite de tokens. Comece uma nova para continuar com ${agent.name}.`}
          </Typography>
          {past ? (
            <Button variant="outlined" onClick={() => onView(sessions.current)}>
              Voltar para a conversa atual
            </Button>
          ) : (
            <Button variant="contained" disabled={starting} onClick={startNew}>
              Nova conversa
            </Button>
          )}
        </Stack>
      )}
      <Box
        component="form"
        hidden={past}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        sx={{
          display: 'flex',
          flexShrink: 0,
          alignItems: 'flex-end',
          gap: 1,
          borderTop: 1,
          borderColor: 'divider',
          p: 1.5,
        }}
      >
        <Box
          component="textarea"
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
          sx={{
            maxHeight: 160,
            minHeight: 40,
            flex: 1,
            resize: 'none',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            p: 1,
            fontSize: 14,
            fontFamily: 'inherit',
          }}
        />
        <IconButton
          type="submit"
          aria-label="Enviar"
          disabled={sending || full || !draft.trim()}
          color="primary"
        >
          <SendHorizontal size={18} />
        </IconButton>
      </Box>
      {sendError && (
        <Typography variant="body2" sx={{ px: 1.5, pb: 1, color: 'error.main' }}>
          {sendError}
        </Typography>
      )}
    </Box>
  );
}
