import { useLayoutEffect, useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Realtime } from '../api';

interface TypingEvent {
  display_id?: number;
  recording?: boolean;
  user?: { type?: string; id?: number; name?: string | null };
}
interface Props {
  realtime: Realtime;
  displayId: number;
  currentUserId: number;
}

/** Indicador de digitação no C3Theme (lote 20): “<nome> está digitando…” some após 10 s. */
export function TypingIndicator({ realtime, displayId, currentUserId }: Props) {
  const [typing, setTyping] = useState<{ name: string; recording: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Subscribes at commit (not after paint) so an event right after the conversation renders is not lost.
  useLayoutEffect(() => {
    const unsubscribe = realtime.subscribe(({ event, data }) => {
      if (!event.startsWith('conversation.typing_')) return;
      const e = data as TypingEvent;
      if (e.display_id !== displayId) return;
      if (e.user?.type === 'user' && e.user.id === currentUserId) return;
      clearTimeout(timer.current);
      if (event === 'conversation.typing_off') return setTyping(null);
      setTyping({ name: e.user?.name || 'Contato', recording: Boolean(e.recording) });
      timer.current = setTimeout(() => setTyping(null), 10_000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, [realtime, displayId, currentUserId]);
  if (!typing) return null;
  return (
    <Stack
      component="p"
      role="status"
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', px: 2, pb: 0.5, color: 'text.secondary', m: 0 }}
    >
      <Box component="span" aria-hidden sx={{ display: 'flex', gap: 0.5 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            component="span"
            className="animate-bounce"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: 'text.disabled',
              animationDelay: `${i * 150}ms`,
            }}
          />
        ))}
      </Box>
      <Typography variant="caption" color="inherit">
        {typing.name} {typing.recording ? 'está gravando áudio…' : 'está digitando…'}
      </Typography>
    </Stack>
  );
}
