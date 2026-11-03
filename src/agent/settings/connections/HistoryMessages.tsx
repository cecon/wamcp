import { useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { http, query } from '../../api';
import type { HistoryMessage } from './model';

const PAGE_SIZE = 50;

const page = (base: string, jid: string, before?: HistoryMessage) =>
  http<HistoryMessage[]>(
    `${base}/messages${query({ jid, limit: PAGE_SIZE, before: before?.ts, beforeId: before?.id })}`,
  );

interface Props {
  /** /sessions/{id} */
  base: string;
  jid: string;
  title: string;
}

/** Messages of one mirrored chat, oldest first; "Carregar anteriores" pages back with before/beforeId. */
export function HistoryMessages({ base, jid, title }: Props) {
  const [messages, setMessages] = useState<HistoryMessage[] | null>(null),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    page(base, jid)
      .then((loaded) => {
        if (!live) return;
        setMessages(loaded);
        setMore(loaded.length === PAGE_SIZE);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [base, jid]);
  async function older() {
    setBusy(true);
    try {
      const loaded = await page(base, jid, messages?.[0]);
      setMessages((current) => [
        ...loaded,
        ...(current || []).filter((m) => !loaded.some((l) => l.id === m.id)),
      ]);
      setMore(loaded.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box
      component="section"
      aria-label={`Mensagens de ${title}`}
      sx={{ display: 'flex', minHeight: 0, flexDirection: 'column' }}
    >
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, py: 1.5 }}>
        <Typography component="p" variant="h6">
          {title}
        </Typography>
        <Typography component="p" variant="caption" color="text.secondary">
          {jid}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          maxHeight: '28rem',
          minHeight: 0,
          flex: 1,
          flexDirection: 'column',
          gap: 1,
          overflowY: 'auto',
          bgcolor: 'var(--color-n-surface-2)',
          p: 2,
        }}
      >
        {error && (
          <Alert severity="error" sx={{ fontSize: 14 }}>
            {error}
          </Alert>
        )}
        {more && (
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => void older()}
            sx={{ alignSelf: 'center' }}
          >
            {busy ? 'Carregando…' : 'Carregar anteriores'}
          </Button>
        )}
        {messages?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nenhuma mensagem sincronizada.
          </Typography>
        )}
        {messages?.map((m) => (
          <Box
            key={m.id}
            sx={{
              maxWidth: '75%',
              borderRadius: 2.5,
              px: 1.5,
              py: 1,
              fontSize: 14,
              alignSelf: m.from_me ? 'flex-end' : 'flex-start',
              bgcolor: m.from_me ? 'var(--color-n-solid-blue)' : 'var(--color-n-solid-1)',
              color: 'var(--color-n-slate-12)',
            }}
          >
            {!m.from_me && m.sender && (
              <Typography
                component="p"
                variant="caption"
                sx={{ fontWeight: 500, color: 'var(--color-n-slate-11)' }}
              >
                {m.sender}
              </Typography>
            )}
            <Typography component="p" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {m.body}
            </Typography>
            <Box
              component="time"
              sx={{
                display: 'block',
                mt: 0.5,
                textAlign: 'right',
                fontSize: '0.625rem',
                color: 'var(--color-n-slate-10)',
              }}
            >
              {new Date(m.ts * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
