import { useCallback, useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { LogOut, Monitor } from 'lucide-react';

import { http } from '../api';
import type { SessionInfo } from '../accountTypes';
import { useAction } from '../settings/useAction';
import { describeUserAgent, formatDateTime } from './browser';

/** Active browser sessions (GET /profile/sessions): revoke one or every other session. */
export function SessionsSection() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<SessionInfo[]>('/profile/sessions').then(setSessions), []);
  useEffect(() => {
    void load().catch(() => setSessions([]));
  }, [load]);
  const others = (sessions || []).filter((s) => !s.current);
  const revoke = (path: string) =>
    void run(async () => {
      await http(path, 'DELETE');
      await load();
    });

  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error">{error}</Alert>}
      <Box
        component="ul"
        aria-label="Sessões ativas"
        sx={{ m: 0, p: 0, listStyle: 'none', borderRadius: 1.5, border: 1, borderColor: 'divider' }}
      >
        {(sessions || []).map((s) => {
          const name = describeUserAgent(s.user_agent);
          return (
            <Box
              component="li"
              key={s.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 0 },
              }}
            >
              <Box sx={{ flexShrink: 0, display: 'flex', color: 'text.disabled' }}>
                <Monitor size={18} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {name}
                  </Typography>
                  {s.current && (
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label="Esta sessão"
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Entrou em {formatDateTime(s.created)} · Último acesso{' '}
                  {formatDateTime(s.last_seen || s.created)}
                </Typography>
              </Box>
              {!s.current && (
                <Button
                  color="error"
                  variant="outlined"
                  size="small"
                  aria-label={`Encerrar sessão ${name}`}
                  disabled={busy}
                  onClick={() => revoke(`/profile/sessions/${s.id}`)}
                >
                  Encerrar
                </Button>
              )}
            </Box>
          );
        })}
      </Box>
      {sessions && others.length > 0 && (
        <Button
          color="error"
          variant="outlined"
          size="small"
          startIcon={<LogOut size={14} />}
          sx={{ alignSelf: 'flex-start' }}
          disabled={busy}
          onClick={() => revoke('/profile/sessions')}
        >
          Encerrar outras sessões
        </Button>
      )}
    </Stack>
  );
}
