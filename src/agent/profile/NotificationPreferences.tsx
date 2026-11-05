import { useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import type { NotificationSettings } from '../accountTypes';
import { NOTIFICATION_TYPES } from '../notifications/notificationText';
import {
  loadAlertPrefs,
  playChime,
  requestDesktopPermission,
  saveAlertPrefs,
  type AlertPrefs,
} from '../notifications/browserAlerts';

/** One switch row (label and hint on the left), with the `switch` role kept for assistive technology. */
function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: 'flex-start', justifyContent: 'space-between', py: 1.5 }}
    >
      <Box>
        <Typography variant="subtitle2">{label}</Typography>
        {hint && (
          <Typography variant="body2" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{ input: { 'aria-label': label } }}
      />
    </Stack>
  );
}

/** Per-type notification flags (GET/PATCH /notification_settings) and this browser's alerts. */
export function NotificationPreferences() {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    http<NotificationSettings>('/notification_settings')
      .then((r) => setFlags(r.flags))
      .catch((e: Error) => setError(e.message));
  }, []);
  const toggle = (type: string, enabled: boolean) => {
    setError('');
    http<NotificationSettings>('/notification_settings', 'PATCH', { flags: { [type]: enabled } })
      .then((r) => setFlags(r.flags))
      .catch((e: Error) => setError(e.message));
  };
  return (
    <Stack>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        Tipo de notificação
      </Typography>
      <Box>
        {NOTIFICATION_TYPES.map(([type, label]) => (
          <Box key={type} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <SwitchRow
              label={label}
              checked={flags?.[type] ?? true}
              onChange={(enabled) => toggle(type, enabled)}
            />
          </Box>
        ))}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="h6" component="h3" sx={{ mt: 3, mb: 1 }}>
        Alertas neste navegador
      </Typography>
      <BrowserAlerts />
    </Stack>
  );
}

function BrowserAlerts() {
  const [prefs, setPrefs] = useState<AlertPrefs>(loadAlertPrefs),
    [notice, setNotice] = useState('');
  const update = (next: AlertPrefs) => {
    setPrefs(next);
    saveAlertPrefs(next);
  };
  return (
    <>
      <Divider sx={{ mb: 0.5 }} />
      <SwitchRow
        label="Notificações na área de trabalho"
        hint="Mostra um aviso do sistema a cada nova notificação, mesmo com a aba em segundo plano."
        checked={prefs.desktop}
        onChange={(desktop) => {
          setNotice('');
          if (!desktop) return update({ ...prefs, desktop });
          void requestDesktopPermission().then((granted) =>
            granted
              ? update({ ...prefs, desktop })
              : setNotice('Ative as notificações para este site nas permissões do navegador.'),
          );
        }}
      />
      <Divider />
      <SwitchRow
        label="Alerta sonoro"
        hint="Toca um som curto a cada nova notificação."
        checked={prefs.sound}
        onChange={(sound) => {
          update({ ...prefs, sound });
          if (sound) playChime();
        }}
      />
      {notice && (
        <Typography variant="body2" role="status" sx={{ py: 1, color: 'warning.main' }}>
          {notice}
        </Typography>
      )}
    </>
  );
}
