import { useEffect, useState } from 'react';
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
import { Toggle } from '../ui/Settings';

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
    <div className="flex flex-col">
      <h3 className="text-heading-3 text-n-slate-12">Tipo de notificação</h3>
      <div className="divide-y divide-n-weak">
        {NOTIFICATION_TYPES.map(([type, label]) => (
          <Toggle
            key={type}
            label={label}
            checked={flags?.[type] ?? true}
            onChange={(enabled) => toggle(type, enabled)}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <h3 className="text-heading-3 mt-6 text-n-slate-12">Alertas neste navegador</h3>
      <BrowserAlerts />
    </div>
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
    <div className="divide-y divide-n-weak">
      <Toggle
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
      <Toggle
        label="Alerta sonoro"
        hint="Toca um som curto a cada nova notificação."
        checked={prefs.sound}
        onChange={(sound) => {
          update({ ...prefs, sound });
          if (sound) playChime();
        }}
      />
      {notice && (
        <p role="status" className="py-2 text-sm text-n-amber-11">
          {notice}
        </p>
      )}
    </div>
  );
}
