// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

// third-party
import { RefreshCcw } from 'lucide-react';

import type { Message, Reaction } from '../types';
import { authorOf, snippet } from './messageText';

/** Prévia da mensagem citada no C3Theme (lote 18): clicar rola até a original. */
export function QuotedMessage({ message, onJump }: { message: Message; onJump?: (id: number) => void }) {
  return (
    <Button
      variant="text"
      aria-label={`Ir para a mensagem citada de ${authorOf(message)}`}
      onClick={() => onJump?.(message.id)}
      sx={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        textTransform: 'none',
        borderLeft: 4,
        borderColor: 'primary.main',
        borderRadius: 1,
        bgcolor: 'action.hover',
        p: 1,
        mb: 1,
      }}
    >
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 500, color: 'primary.main' }}>
        {authorOf(message)}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {snippet(message)}
      </Typography>
    </Button>
  );
}

/** Chips de reação no C3Theme: contagem por emoji e nomes no tooltip. */
export function Reactions({
  reactions,
  outgoing,
  mine,
}: {
  reactions: Reaction[];
  outgoing: boolean;
  mine?: (r: Reaction) => boolean;
}) {
  if (!reactions.length) return null;
  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) groups.set(r.emoji, [...(groups.get(r.emoji) || []), r]);
  return (
    <Box
      component="ul"
      aria-label="Reações"
      sx={{
        mt: -0.5,
        display: 'flex',
        gap: 0.5,
        listStyle: 'none',
        m: 0,
        p: 0,
        justifyContent: outgoing ? 'flex-end' : 'flex-start',
      }}
    >
      {[...groups].map(([emoji, list]) => (
        <Box
          component="li"
          key={emoji}
          title={list.map((r) => r.sender_name || 'Contato').join(', ')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            borderRadius: 99,
            border: 1,
            borderColor: list.some((r) => mine?.(r)) ? 'primary.main' : 'divider',
            bgcolor: 'background.paper',
            px: 0.75,
            fontSize: 12,
            boxShadow: 1,
          }}
        >
          <span>{emoji}</span>
          {list.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              {list.length}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** Botão de reenvio do C3Theme (o motivo fica no tooltip do status). */
export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button
      size="small"
      variant="text"
      color="error"
      startIcon={<RefreshCcw size={12} />}
      onClick={onRetry}
      sx={{ mt: 0.5, ml: 'auto', py: 0, minHeight: 20, fontSize: 12, textTransform: 'none' }}
    >
      Reenviar
    </Button>
  );
}
