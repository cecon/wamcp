// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { CircleAlert, Lightbulb, Wrench } from 'lucide-react';

import { MemberAvatar } from '../settings/members/MemberAvatar';
import { MessageBody } from '../conversations/MessageBody';
import { ChatMarkdown } from './ChatMarkdown';
import { chatTime, type ChatAgent, type ChatMessage, type ChatStep } from './types';

/** Newest steps shown while the agent works (older ones scroll away). */
const SHOWN_STEPS = 6;

/** Lista de mensagens e o “pensando” do agente no C3Theme (lote 27). */
export function AgentChatMessages({
  agent,
  messages,
  steps,
  waiting,
}: {
  agent: ChatAgent;
  messages: ChatMessage[];
  steps: ChatStep[];
  waiting: boolean;
}) {
  return (
    <>
      <Stack component="ul" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {messages.map((m) => (
          <Box
            component="li"
            key={m.id}
            sx={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              pl: m.role === 'user' ? 5 : 0,
              pr: m.role === 'user' ? 0 : 5,
            }}
          >
            <Box
              sx={{
                maxWidth: 512,
                minWidth: 0,
                borderRadius: 2,
                borderBottomRightRadius: m.role === 'user' ? 4 : undefined,
                borderBottomLeftRadius: m.role === 'user' ? undefined : 4,
                px: 2,
                py: 1.5,
                fontSize: 14,
                bgcolor:
                  m.role === 'user'
                    ? 'var(--color-n-solid-blue)'
                    : m.role === 'error'
                      ? 'var(--color-n-ruby-4)'
                      : 'var(--color-n-solid-iris)',
                color: m.role === 'error' ? 'var(--color-n-ruby-12)' : 'var(--color-n-slate-12)',
              }}
            >
              {m.role === 'error' && (
                <Stack direction="row" spacing={0.5} sx={{ mb: 0.5, alignItems: 'center' }}>
                  <CircleAlert size={12} />
                  <Typography variant="caption" sx={{ fontWeight: 500 }}>
                    Sem resposta
                  </Typography>
                </Stack>
              )}
              {m.role === 'user' ? <MessageBody content={m.content} /> : <ChatMarkdown content={m.content} />}
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 1, textAlign: 'right', color: 'text.secondary' }}
              >
                {chatTime(m.created_at)}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>
      {waiting && (
        <Stack direction="row" role="status" spacing={1} sx={{ mt: 1, pr: 5, alignItems: 'flex-end' }}>
          <MemberAvatar choices={agent.avatar} kind="ai" seed={agent.id} size={24} title={agent.name} />
          <Stack
            spacing={1}
            sx={{
              maxWidth: 512,
              minWidth: 0,
              borderRadius: 2,
              borderBottomLeftRadius: 4,
              bgcolor: 'var(--color-n-solid-iris)',
              px: 2,
              py: 1.5,
            }}
          >
            {steps.length > 0 && (
              <Box
                component="ol"
                aria-label={`O que ${agent.name} está fazendo`}
                sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, m: 0, p: 0, listStyle: 'none' }}
              >
                {steps.slice(-SHOWN_STEPS).map((step, i, shown) => (
                  <Box
                    component="li"
                    key={steps.length - shown.length + i}
                    sx={{
                      display: 'flex',
                      gap: 1,
                      fontSize: 12,
                      color: 'text.secondary',
                      opacity: i < shown.length - 1 ? 0.6 : 1,
                    }}
                  >
                    {step.kind === 'tool' ? (
                      <Wrench size={12} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
                    ) : (
                      <Lightbulb size={12} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
                    )}
                    <Box
                      component="span"
                      sx={{ minWidth: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                    >
                      {step.kind === 'tool' ? `Usando ${step.text}` : step.text}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
            <Stack direction="row" spacing={0.5} aria-hidden sx={{ height: 16, alignItems: 'center' }}>
              {[0, 1, 2].map((i) => (
                <Box
                  key={i}
                  className="animate-bounce"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: 'var(--color-n-iris-9)',
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {agent.name} está pensando…
          </Typography>
        </Stack>
      )}
    </>
  );
}
