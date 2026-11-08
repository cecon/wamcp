import { useCallback, useEffect, useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { listen } from '@tauri-apps/api/event';
import { Download, X } from 'lucide-react';

import { CHECK_UPDATES_EVENT, desktop, isDesktop, nativeError } from './tauri';

/** First automatic check after opening, then every six hours. */
export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Desktop updates (Tauri window only): checks in the background, downloads and verifies the
 * signature, then offers "Reiniciar e atualizar". Manual checks come from Configurações → Aplicativo.
 */
export function UpdateNotice() {
  const [version, setVersion] = useState(''),
    [message, setMessage] = useState(''),
    [installing, setInstalling] = useState(false);
  const checking = useRef(false);
  const check = useCallback(async (manual = false) => {
    if (checking.current) return;
    checking.current = true;
    if (manual) setMessage('Verificando atualizações…');
    try {
      const update = await desktop.checkUpdate();
      setVersion(update?.version || '');
      setMessage(
        update
          ? 'Atualização baixada e verificada. As conexões serão retomadas após reiniciar.'
          : manual
            ? 'Você está na versão mais recente.'
            : '',
      );
    } catch (error) {
      setMessage(manual ? nativeError(error) : '');
    } finally {
      checking.current = false;
    }
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    const initial = setTimeout(() => void check(), FIRST_CHECK_MS);
    const interval = setInterval(() => void check(), CHECK_EVERY_MS);
    const manual = () => void check(true);
    window.addEventListener(CHECK_UPDATES_EVENT, manual);
    const listener = listen<string>('update-downloading', (event) =>
      setMessage(`Baixando a versão ${event.payload} em segundo plano…`),
    );
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener(CHECK_UPDATES_EVENT, manual);
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [check]);
  async function install() {
    setInstalling(true);
    setMessage('Instalando a atualização. O aplicativo será reaberto automaticamente…');
    try {
      await desktop.installUpdate();
    } catch (error) {
      setVersion('');
      setMessage(nativeError(error));
      setInstalling(false);
    }
  }
  if (!message) return null;
  return (
    <Paper
      role="status"
      elevation={8}
      sx={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 50,
        display: 'flex',
        width: 384,
        maxWidth: 'calc(100vw - 2rem)',
        alignItems: 'flex-start',
        gap: 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'var(--color-n-solid-2)',
        p: 2,
      }}
    >
      <Box sx={{ flexShrink: 0, display: 'flex', pt: 0.25, color: 'primary.main' }}>
        <Download size={18} />
      </Box>
      <Stack sx={{ minWidth: 0, flex: 1 }}>
        {version && <Typography variant="subtitle2">WA MCP {version} disponível</Typography>}
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
        {version && (
          <Button
            variant="contained"
            size="small"
            sx={{ mt: 1.5, alignSelf: 'flex-start' }}
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? 'Instalando…' : 'Reiniciar e atualizar'}
          </Button>
        )}
      </Stack>
      {!installing && (
        <IconButton size="small" aria-label="Fechar aviso de atualização" onClick={() => setMessage('')}>
          <X size={14} />
        </IconButton>
      )}
    </Paper>
  );
}
