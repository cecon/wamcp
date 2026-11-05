import { useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { ShieldCheck, ShieldOff } from 'lucide-react';

import { http } from '../api';
import type { MfaSetup } from '../accountTypes';
import { useAction } from '../settings/useAction';
import C3Provider from '../c3/C3Provider';
import { BackupCodesModal } from './BackupCodes';
import { DisableMfaModal, MfaSetupModal } from './MfaModals';

/** Two-factor status with the enable flow (QR → code → backup codes) and the disable dialog. */
export function MfaSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [setup, setSetup] = useState<MfaSetup | null>(null),
    [codes, setCodes] = useState<string[] | null>(null),
    [disabling, setDisabling] = useState(false);
  const { error, busy, run } = useAction();
  useEffect(() => {
    http<{ enabled: boolean }>('/profile/mfa')
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);
  if (enabled === null)
    return (
      <Typography variant="body2" color="text.secondary">
        Carregando…
      </Typography>
    );

  return (
    <C3Provider>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: 'flex-start',
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            p: 2,
          }}
        >
          <Box
            sx={{
              flexShrink: 0,
              display: 'flex',
              pt: 0.25,
              color: enabled ? 'success.main' : 'text.disabled',
            }}
          >
            {enabled ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {enabled
                ? 'A verificação em duas etapas está ativa'
                : 'A verificação em duas etapas está desativada'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {enabled
                ? 'Sua conta está protegida com uma camada extra de segurança.'
                : 'Ao entrar, além da senha será pedido o código do aplicativo autenticador (Google Authenticator, Authy…).'}
            </Typography>
          </Box>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {enabled ? (
          <Button
            color="error"
            variant="outlined"
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setDisabling(true)}
          >
            Desativar verificação em duas etapas
          </Button>
        ) : (
          <Button
            variant="contained"
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            disabled={busy}
            onClick={() => void run(async () => setSetup(await http<MfaSetup>('/profile/mfa', 'POST')))}
          >
            Ativar verificação em duas etapas
          </Button>
        )}
        {setup && (
          <MfaSetupModal
            setup={setup}
            onClose={() => setSetup(null)}
            onEnabled={(backup) => {
              setSetup(null);
              setEnabled(true);
              setCodes(backup);
            }}
          />
        )}
        {codes && <BackupCodesModal codes={codes} onClose={() => setCodes(null)} />}
        {disabling && (
          <DisableMfaModal
            onClose={() => setDisabling(false)}
            onDisabled={() => {
              setDisabling(false);
              setEnabled(false);
            }}
          />
        )}
      </Stack>
    </C3Provider>
  );
}
