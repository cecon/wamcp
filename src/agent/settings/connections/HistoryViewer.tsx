import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { MessageCircle, Search } from 'lucide-react';

import { http, initials, query } from '../../api';
import { useFetch } from '../../useFetch';
import { HistoryMessages } from './HistoryMessages';
import { sessionPath, type HistoryChat, type HistoryMessage } from './model';

const chatName = (chat: Pick<HistoryChat, 'jid' | 'name'> | undefined, jid: string) =>
  chat?.name || jid.split('@')[0];

/** Histórico tab: the local WhatsApp mirror (chats, messages with pagination, full-text search). */
export function HistoryViewer({ id }: { id: string }) {
  const base = sessionPath(id);
  const [q, setQ] = useState(''),
    [term, setTerm] = useState(''),
    [results, setResults] = useState<HistoryMessage[] | null>(null),
    [jid, setJid] = useState(''),
    [searchError, setSearchError] = useState('');
  const { data: chats, error } = useFetch<HistoryChat[]>(`${base}/chats${query({ q })}`);
  async function search() {
    setSearchError('');
    try {
      setResults(await http<HistoryMessage[]>(`${base}/search${query({ q: term.trim() })}`));
    } catch (e) {
      setSearchError((e as Error).message);
    }
  }
  const list = chats || [];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        sx={{ display: 'flex', maxWidth: 576, gap: 1 }}
      >
        <TextField
          size="small"
          fullWidth
          value={term}
          placeholder="Buscar em todas as mensagens"
          onChange={(e) => setTerm(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200, 'aria-label': 'Buscar em todas as mensagens' } }}
        />
        <Button type="submit" variant="contained" startIcon={<Search size={16} />} disabled={!term.trim()}>
          Buscar
        </Button>
      </Box>
      {(error || searchError) && (
        <Alert severity="error" sx={{ fontSize: 14 }}>
          {error || searchError}
        </Alert>
      )}
      {results && (
        <Box
          component="section"
          aria-label="Resultados da busca"
          sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: 1,
              borderColor: 'divider',
              px: 2,
              py: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {results.length} {results.length === 1 ? 'mensagem encontrada' : 'mensagens encontradas'}
            </Typography>
            <Button size="small" variant="text" onClick={() => setResults(null)}>
              Limpar busca
            </Button>
          </Box>
          <Box component="ul" sx={{ maxHeight: 256, overflowY: 'auto', m: 0, p: 0, listStyle: 'none' }}>
            {results.map((m) => (
              <Box component="li" key={`${m.jid}-${m.id}`} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <ButtonBase
                  onClick={() => setJid(m.jid)}
                  sx={{ display: 'block', width: '100%', px: 2, py: 1, textAlign: 'left' }}
                >
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block' }}
                  >
                    {chatName(
                      list.find((c) => c.jid === m.jid),
                      m.jid,
                    )}{' '}
                    · {new Date(m.ts * 1000).toLocaleString('pt-BR')}
                  </Typography>
                  <Typography
                    component="span"
                    variant="body2"
                    noWrap
                    sx={{ display: 'block', color: 'var(--color-n-slate-12)' }}
                  >
                    {m.body}
                  </Typography>
                </ButtonBase>
              </Box>
            ))}
          </Box>
        </Box>
      )}
      <Box
        sx={{
          display: 'grid',
          minHeight: '28rem',
          overflow: 'hidden',
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          gridTemplateColumns: { md: '18rem 1fr' },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            minHeight: 0,
            flexDirection: 'column',
            borderBottom: { md: 0 },
            borderRight: { md: 1 },
            borderColor: 'divider',
          }}
        >
          <TextField
            size="small"
            value={q}
            placeholder="Buscar conversa"
            onChange={(e) => setQ(e.target.value)}
            sx={{ m: 1.5 }}
            slotProps={{
              htmlInput: { 'aria-label': 'Buscar conversa' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={14} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box
            component="ul"
            aria-label="Conversas do WhatsApp"
            sx={{ maxHeight: 448, minHeight: 0, flex: 1, overflowY: 'auto', m: 0, p: 0, listStyle: 'none' }}
          >
            {chats && list.length === 0 && (
              <Typography component="li" variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
                Nenhuma conversa. Conecte o WhatsApp e aguarde a sincronização.
              </Typography>
            )}
            {list.map((c) => (
              <Box component="li" key={c.jid}>
                <ButtonBase
                  aria-current={jid === c.jid ? 'true' : undefined}
                  onClick={() => setJid(c.jid)}
                  sx={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    textAlign: 'left',
                    bgcolor: jid === c.jid ? 'var(--color-n-alpha-2)' : undefined,
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      display: 'flex',
                      width: 32,
                      height: 32,
                      flexShrink: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      bgcolor: 'var(--color-n-slate-4)',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {initials(chatName(c, c.jid))}
                  </Box>
                  <Box component="span" sx={{ minWidth: 0 }}>
                    <Typography
                      component="span"
                      variant="body2"
                      sx={{ display: 'block', fontWeight: 500, color: 'var(--color-n-slate-12)' }}
                      noWrap
                    >
                      {chatName(c, c.jid)}
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block' }}
                      noWrap
                    >
                      {c.preview || 'Sem mensagens'}
                    </Typography>
                  </Box>
                </ButtonBase>
              </Box>
            ))}
          </Box>
        </Box>
        {jid ? (
          <HistoryMessages
            key={jid}
            base={base}
            jid={jid}
            title={chatName(
              list.find((c) => c.jid === jid),
              jid,
            )}
          />
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              p: 4,
              textAlign: 'center',
            }}
          >
            <Box component={MessageCircle} size={36} sx={{ color: 'var(--color-n-slate-9)' }} />
            <Typography component="p" variant="h6">
              Histórico do WhatsApp
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Selecione uma conversa para ver as mensagens.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
