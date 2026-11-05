import { useMemo, useState, type ComponentType, type ReactNode } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { ArrowLeft } from 'lucide-react';

// C3Theme (o AssistantPanel 0.3+ só existe no pacote novo: acesso dinâmico para o app seguir compilando antes do install)
import * as chatUi from '@c3theme/chat';

import C3Provider from '../c3/C3Provider';
import type { ChatAgent, ChatMessage, ChatSessions, ChatStep } from './types';

interface C3Author {
  id: string;
  name: string;
}
interface C3Tool {
  id: string;
  name: string;
  label?: string;
  status: 'running' | 'done' | 'error';
}
interface C3Message {
  id: string;
  conversationId: string;
  author: C3Author;
  direction: 'in' | 'out';
  kind?: 'text' | 'system';
  text?: string;
  format?: 'plain' | 'markdown';
  streaming?: boolean;
  tools?: C3Tool[];
  reasoning?: string;
  createdAt: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
}
interface C3Conversation {
  id: string;
  title: string;
  subtitle?: string;
  unread: number;
  updatedAt: string;
}

type AssistantPanelProps = {
  chat: Record<string, unknown>;
  title?: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
  conversations?: C3Conversation[];
  onSelectConversation?: (id: string) => void;
  onNewConversation?: () => void;
  suggestions?: string[];
  empty?: ReactNode;
  composer?: Record<string, unknown>;
};

/** O `AssistantPanel` do `@c3theme/chat` 0.3+ (undefined com o pacote antigo até rodar `pnpm install`). */
const AssistantPanel = (chatUi as unknown as { AssistantPanel?: ComponentType<AssistantPanelProps> })
  .AssistantPanel;

interface Props {
  agent: ChatAgent;
  messages: ChatMessage[];
  /** O que o agente está fazendo na resposta em andamento (vira ferramentas/raciocínio na mensagem pendente). */
  steps: ChatStep[];
  sessions: ChatSessions | null;
  viewing: number;
  onView: (session: number) => void;
  onNewSession: () => void;
  starting: boolean;
  onSend: (text: string) => Promise<void>;
  onBack: () => void;
}

/**
 * Chat do Agente de IA no `AssistantPanel` do C3Theme (frente `?c3assistant`): streaming, “Pensando…”, ferramentas,
 * raciocínio, seletor de sessões e o compositor com dicas — em vez da thread caseira. Fica atrás de flag até a paridade
 * (sessões encerradas, limite de tokens e testes) ser fechada.
 */
export function AgentChatC3(props: Props) {
  const { agent, messages, steps, sessions, viewing, onView, onNewSession, starting, onSend, onBack } = props;
  const [pendente, setPendente] = useState<string | null>(null),
    [erro, setErro] = useState('');

  const past = sessions !== null && viewing !== sessions.current;
  const full = sessions?.sessions.find((s) => s.number === sessions.current)?.full ?? false;
  const ultima = messages.at(-1);
  const aguardando = !past && ultima?.role === 'user';
  const ocupado = Boolean(pendente) || aguardando;
  const bloqueado = past || full;

  async function enviar(texto: string) {
    const t = texto.trim();
    if (!t || ocupado || bloqueado) return;
    setErro('');
    setPendente(t);
    try {
      await onSend(t);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setPendente(null);
    }
  }

  const conversas = useMemo<C3Conversation[]>(() => {
    if (!sessions) return [];
    const atual = sessions.current;
    return sessions.sessions
      .map((s) => ({
        id: String(s.number),
        title: s.number === atual ? 'Conversa atual' : `Conversa ${s.number}`,
        subtitle: s.preview || 'Sem mensagens',
        unread: 0,
        updatedAt: new Date(s.started_at).toISOString(),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [sessions]);

  const lista = useMemo<C3Message[]>(() => {
    const autorEu = { id: 'eu', name: 'Você' };
    const autorAgente = { id: String(agent.id), name: agent.name };
    const base: C3Message[] = messages.map((m) => {
      const eu = m.role === 'user';
      return {
        id: String(m.id),
        conversationId: String(m.session),
        author: eu ? autorEu : autorAgente,
        direction: eu ? 'out' : 'in',
        kind: m.role === 'error' ? 'system' : undefined,
        text: m.content,
        format: eu ? 'plain' : 'markdown',
        createdAt: new Date(m.created_at).toISOString(),
        status: 'sent',
      };
    });
    if (!ocupado) return base;
    // Enquanto o backend pensa: a pergunta enviada e a resposta em andamento com ferramentas/raciocínio ao vivo.
    const agora = new Date().toISOString();
    if (pendente) {
      base.push({
        id: 'pendente',
        conversationId: String(viewing),
        author: autorEu,
        direction: 'out',
        text: pendente,
        createdAt: agora,
        status: 'sent',
      });
    }
    const tools = steps
      .filter((s) => s.kind === 'tool')
      .map(
        (s, i) =>
          ({
            id: `passo-${i}`,
            name: s.text,
            status: i === steps.filter((x) => x.kind === 'tool').length - 1 ? 'running' : 'done',
          }) as C3Tool,
      );
    base.push({
      id: 'resposta-em-andamento',
      conversationId: String(viewing),
      author: autorAgente,
      direction: 'in',
      streaming: true,
      tools,
      reasoning: steps
        .filter((s) => s.kind === 'note')
        .map((s) => s.text)
        .join('\n'),
      createdAt: agora,
    });
    return base;
  }, [messages, ocupado, pendente, steps, viewing, agent.id, agent.name]);

  const chat = useMemo<Record<string, unknown>>(
    () => ({
      conversationId: String(viewing),
      messages: lista,
      hasMore: false,
      loading: null,
      loadOlder: async () => {},
      send: (texto: string) => void enviar(texto),
      retry: () => {},
      stop: undefined,
      generating: ocupado,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lista, ocupado, viewing],
  );

  if (!AssistantPanel)
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        O `@c3theme/chat` instalado é antigo (sem `AssistantPanel`). Rode `pnpm install` para atualizar para
        0.3+.
      </Alert>
    );

  return (
    <C3Provider>
      <Box
        component="section"
        aria-label={`Conversa com ${agent.name}`}
        sx={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}
      >
        {erro && (
          <Alert severity="error" sx={{ m: 1.5 }} onClose={() => setErro('')}>
            {erro}
          </Alert>
        )}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <AssistantPanel
            title={agent.name}
            chat={chat}
            conversations={conversas}
            onSelectConversation={(id) => onView(Number(id))}
            onNewConversation={onNewSession}
            actions={
              <IconButton
                size="small"
                aria-label="Voltar"
                onClick={onBack}
                sx={{ display: { xs: 'inline-flex', md: 'none' } }}
              >
                <ArrowLeft size={16} />
              </IconButton>
            }
            empty={
              <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', mt: 5, px: 2 }}>
                <Typography variant="subtitle1">Converse com {agent.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
                  {agent.description || `Escreva para ${agent.name}.`} Esta conversa é só sua: não vai para o
                  WhatsApp e ninguém mais da equipe vê.
                </Typography>
              </Stack>
            }
            composer={{
              placeholder: `Mensagem para ${agent.name}`,
              files: false,
              voice: false,
              disabled: bloqueado || Boolean(starting),
              hint: 'Enter envia · Shift+Enter quebra a linha',
            }}
          />
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
              <Button variant="outlined" onClick={() => onView(sessions!.current)}>
                Voltar para a conversa atual
              </Button>
            ) : (
              <Button variant="contained" disabled={starting} onClick={onNewSession}>
                Nova conversa
              </Button>
            )}
          </Stack>
        )}
      </Box>
    </C3Provider>
  );
}
