import { useState } from 'react';
import { MemoryRouter } from 'react-router';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { StyledEngineProvider } from '@mui/material/styles';

// third-party
import { Clock, Message2, People, Setting2 } from 'iconsax-reactjs';

// C3Theme
import {
  AppLayout,
  C3ThemeProvider,
  ColorModeButton,
  FillHeight,
  Notifier,
  Panel,
  notify,
} from '@c3theme/ui';
import { Composer, MessageList } from '@c3theme/chat';
import type { Message } from '@c3theme/chat/core';

/**
 * Spike de convivência (Fase 1 da adoção): monta o shell e o chat do C3Theme ao lado do Tailwind atual, com os
 * tokens do app passados para o tema. Serve para medir preflight, dark mode, z-index e bundle antes de migrar telas.
 * Abra em `/?c3spike`.
 */
const MENU = [
  {
    id: 'atendimento',
    title: 'Atendimento',
    items: [
      { id: 'conversas', title: 'Conversas', icon: Message2, url: '/conversas' },
      { id: 'contatos', title: 'Contatos', icon: People, url: '/contatos' },
    ],
  },
  {
    id: 'sistema',
    title: 'Sistema',
    items: [{ id: 'config', title: 'Configurações', icon: Setting2, url: '/configuracoes' }],
  },
];

/** Cores do app (src/agent/styles/agent.css) passadas como tokens externos: prova a ponte de tokens. */
const TOKENS = {
  light: {
    primary: '#2781f6',
    background: '#f7f7f7',
    paper: '#ffffff',
    text: '#1c2024',
    textSecondary: '#60646c',
    divider: '#e2e7e7',
  },
  dark: {
    primary: '#7eb6ff',
    background: '#1c1d20',
    paper: '#16171a',
    text: '#edeef0',
    textSecondary: '#b0b4ba',
    divider: '#2e3135',
  },
} as const;

const SEED: Message[] = [
  {
    id: 'm1',
    conversationId: 'c1',
    author: { id: 'contact', name: 'Ana Souza' },
    direction: 'in',
    text: 'Oi! Conseguiu ver o orçamento?',
    createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
  },
  {
    id: 'm2',
    conversationId: 'c1',
    author: { id: 'me', name: 'Você' },
    direction: 'out',
    text: 'Bom dia, Ana! Já estou revisando. Te envio até o fim da manhã. 🙂',
    createdAt: new Date(Date.now() - 7 * 60_000).toISOString(),
    status: 'read',
  },
  {
    id: 'm3',
    conversationId: 'c1',
    author: { id: 'contact', name: 'Ana Souza' },
    direction: 'in',
    text: 'Perfeito, obrigada!',
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
];

export default function C3Spike() {
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [text, setText] = useState('');

  function send(value: string) {
    setMessages((current) => [
      ...current,
      {
        id: `local-${current.length}`,
        conversationId: 'c1',
        author: { id: 'me', name: 'Você' },
        direction: 'out',
        text: value,
        createdAt: new Date().toISOString(),
        status: 'sending',
      },
    ]);
    setText('');
    notify('Mensagem adicionada no spike (nada foi enviado).', 'success');
  }

  return (
    <StyledEngineProvider injectFirst>
      <C3ThemeProvider
        branding={{ name: 'WhatsAppMcp', homePath: '/conversas' }}
        defaultConfig={{ brand: 'green', locale: 'pt-BR' }}
        storageKey="wamcp-c3-spike"
        tokens={TOKENS}
      >
        <MemoryRouter initialEntries={['/conversas']}>
          <AppLayout
            menu={MENU}
            header={<ColorModeButton />}
            footer={<Typography variant="caption">Spike de adoção do C3Theme · Fase 1</Typography>}
          >
            <FillHeight sx={{ p: { xs: 0, sm: 2 }, gap: 2, flexDirection: { xs: 'column', lg: 'row' } }}>
              <Panel
                flush
                sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              >
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <MessageList messages={messages} title="Ana Souza" />
                </Box>
                <Divider />
                <Composer value={text} onChange={setText} onSend={send} />
              </Panel>

              <Stack spacing={2} sx={{ width: { xs: '100%', lg: 340 }, flexShrink: 0 }}>
                <Panel title="Convivência de estilos">
                  {/* Tailwind + tokens do app, ao lado de componentes MUI */}
                  <div className="rounded-lg border border-n-weak bg-n-surface-1 p-4">
                    <p className="text-sm text-n-slate-11">
                      Tailwind 4 e <code className="text-n-slate-12">--color-n-*</code> continuam valendo
                      dentro do tema C3.
                    </p>
                    <Button
                      className="mt-2 rounded-full"
                      variant="contained"
                      onClick={() => notify('notify do pacote', 'info')}
                    >
                      Botão MUI com classe Tailwind
                    </Button>
                  </div>
                </Panel>

                <Panel title="O que este spike prova">
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      • <code>AppLayout</code> + menu + header + rodapé do pacote
                    </Typography>
                    <Typography variant="body2">
                      • <code>FillHeight</code> sem <code>calc(100dvh - …)</code>
                    </Typography>
                    <Typography variant="body2">
                      • <code>MessageList</code> virtualizada + <code>Composer</code> com áudio
                    </Typography>
                    <Typography variant="body2">
                      • tokens do app via <code>tokens</code> no provider
                    </Typography>
                    <Typography variant="body2">
                      • Emotion injetado antes do Tailwind (<code>injectFirst</code>)
                    </Typography>
                  </Stack>
                </Panel>

                <Panel>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Clock size={18} />
                    <Typography variant="caption" color="text.secondary">
                      {new Date().toLocaleString('pt-BR')}
                    </Typography>
                  </Stack>
                </Panel>
              </Stack>
            </FillHeight>
          </AppLayout>
        </MemoryRouter>
        <Notifier />
      </C3ThemeProvider>
    </StyledEngineProvider>
  );
}
