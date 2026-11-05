// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { History } from 'lucide-react';

import type { HistoryMessage } from '../types';

interface Props {
  /** Older messages exist: shows “Mensagens anteriores”. */
  older: boolean;
  onOlder: () => void;
  /** WhatsApp channels have the raw message history; GitHub channels do not (the repository is the source). */
  whatsapp: boolean;
  history: HistoryMessage[] | null;
  onLoad: () => void;
}

/** Botão e painel do “Histórico do WhatsApp” (sincronização bruta do aparelho), só em canais WhatsApp. */
export function ConversationHistory({ older, onOlder, whatsapp, history, onLoad }: Props) {
  if (!older && !whatsapp) return null;
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', py: 1.5 }}>
        {older && (
          <Button size="small" variant="outlined" onClick={onOlder}>
            Mensagens anteriores
          </Button>
        )}
        {whatsapp && (
          <Button size="small" variant="outlined" startIcon={<History size={14} />} onClick={onLoad}>
            Histórico do WhatsApp
          </Button>
        )}
      </Stack>
      {whatsapp && history && (
        <Box
          aria-label="Histórico do WhatsApp"
          sx={{
            mx: 2,
            mb: 1.5,
            borderRadius: 2,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            p: 1.5,
          }}
        >
          {history.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Sem histórico anterior sincronizado.
            </Typography>
          )}
          {history.map((h) => (
            <Stack
              key={h.id}
              direction="row"
              spacing={1.5}
              sx={{ justifyContent: 'space-between', py: 0.25 }}
            >
              <Typography variant="caption" sx={{ color: h.from_me ? 'primary.main' : 'text.primary' }}>
                {h.body}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {new Date(h.ts * 1000).toLocaleString('pt-BR')}
              </Typography>
            </Stack>
          ))}
        </Box>
      )}
    </>
  );
}
