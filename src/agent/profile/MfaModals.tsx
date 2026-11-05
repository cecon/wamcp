import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { Copy } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../api';
import type { MfaSetup } from '../accountTypes';
import { useAction } from '../settings/useAction';
import { copyText } from './browser';
import { QrCode } from './qr/QrCode';

/** 6-digit TOTP input (also accepts a backup code where `backup` is set). */
export function CodeInput({
  value,
  onChange,
  label,
  backup,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  backup?: boolean;
}) {
  return (
    <TextField
      label={label}
      size="small"
      fullWidth
      value={value}
      onChange={(event) => onChange(backup ? event.target.value : event.target.value.replace(/\D/g, ''))}
      slotProps={{
        htmlInput: {
          inputMode: backup ? 'text' : 'numeric',
          autoComplete: 'one-time-code',
          maxLength: backup ? 20 : 6,
          placeholder: '000000',
        },
      }}
      sx={{ '& input': { fontFamily: 'monospace', letterSpacing: '0.12em' } }}
    />
  );
}

interface SetupProps {
  setup: MfaSetup;
  onClose: () => void;
  onEnabled: (backupCodes: string[]) => void;
}

/** Enrolment: scan the QR (or type the secret), then confirm with a code from the app. */
export function MfaSetupModal({ setup, onClose, onEnabled }: SetupProps) {
  const [code, setCode] = useState(''),
    [copied, setCopied] = useState(false);
  const { error, busy, run } = useAction();
  const submit = () => {
    if (code.length !== 6) return;
    void run(async () => {
      const result = await http<{ backup_codes: string[] }>('/profile/mfa/verify', 'POST', { code });
      onEnabled(result.backup_codes);
    });
  };

  return (
    <ActionDialog
      open
      title="Ativar verificação em duas etapas"
      description="Use o Google Authenticator, Authy ou qualquer aplicativo compatível com TOTP."
      confirmLabel="Verificar e ativar"
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={submit}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          1. Escaneie o QR Code com o aplicativo autenticador
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <QrCode value={setup.otpauth_uri} label="QR Code para o aplicativo autenticador" />
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">
            Não consegue escanear? Digite a chave secreta manualmente:
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
            <Box
              component="code"
              aria-label="Chave secreta"
              sx={{
                flex: 1,
                minWidth: 0,
                borderRadius: 1,
                bgcolor: 'var(--color-n-alpha-1)',
                px: 1.5,
                py: 1,
                fontFamily: 'monospace',
                fontSize: 14,
                overflowWrap: 'anywhere',
              }}
            >
              {setup.secret}
            </Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Copy size={14} />}
              onClick={() => void copyText(setup.secret).then(setCopied)}
            >
              {copied ? 'Copiada' : 'Copiar'}
            </Button>
          </Stack>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          2. Informe o código de 6 dígitos gerado pelo aplicativo
        </Typography>
        <CodeInput label="Código de verificação" value={code} onChange={setCode} />
      </Stack>
    </ActionDialog>
  );
}

interface DisableProps {
  onClose: () => void;
  onDisabled: () => void;
}

/** Turning two-factor off asks for the password and a current (or backup) code. */
export function DisableMfaModal({ onClose, onDisabled }: DisableProps) {
  const [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const { error, busy, run } = useAction();
  return (
    <ActionDialog
      open
      title="Desativar verificação em duas etapas"
      description="Informe sua senha e um código de verificação (ou de recuperação) para desativar."
      confirmLabel="Desativar"
      backLabel="Cancelar"
      tone="danger"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          await http('/profile/mfa', 'DELETE', { password, code });
          onDisabled();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Senha"
          size="small"
          fullWidth
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          slotProps={{ htmlInput: { autoComplete: 'current-password' } }}
        />
        <CodeInput label="Código de verificação" value={code} onChange={setCode} backup />
      </Stack>
    </ActionDialog>
  );
}
