import { useEffect, useState, type ReactNode } from 'react';

// material-ui
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { Panel } from '@c3theme/ui';

import { SecretField } from '../../ui/SecretField';
import { NoAccess } from '../../ui/NoAccess';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
import {
  CHECK_UPDATES_EVENT,
  desktop,
  isDesktop,
  nativeError,
  type RuntimeStatus,
} from '../../desktop/tauri';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Panel title={title} subtitle={description}>
      {children}
    </Panel>
  );
}

const tunnelLabel = (status: RuntimeStatus | null) =>
  status?.tunnelRunning
    ? 'Conector em execução'
    : status?.tunnelConfigured
      ? 'Túnel configurado, conector parado'
      : 'Túnel não configurado neste computador';

/** Configurações → Aplicativo: native settings of the desktop app (rendered only in the Tauri window). */
export function AppSettingsPage() {
  if (!isDesktop()) return <NoAccess />;
  return <DesktopSettings />;
}

function DesktopSettings() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null),
    [autostart, setAutostart] = useState(false),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    desktop
      .runtimeStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(nativeError(e)));
    desktop
      .autostartStatus()
      .then(setAutostart)
      .catch((e: unknown) => setError(nativeError(e)));
  }, []);
  async function toggleAutostart(enabled: boolean) {
    setError('');
    try {
      await desktop.setAutostart(enabled);
      setAutostart(enabled);
    } catch (e) {
      setError(nativeError(e));
    }
  }
  async function saveTunnel() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await desktop.configureTunnel(token.trim());
      setToken('');
      setStatus(await desktop.runtimeStatus());
      setNotice('Túnel configurado e iniciado.');
    } catch (e) {
      setError(nativeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Aplicativo"
        description="Configurações deste computador: início automático, túnel, acesso pela rede e atualizações."
      />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Stack spacing={3} sx={{ maxWidth: 640 }}>
        <Panel>
          <FormControlLabel
            control={
              <Switch checked={autostart} onChange={(event) => void toggleAutostart(event.target.checked)} />
            }
            label="Iniciar com o Windows"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Abre o WA MCP minimizado na bandeja ao ligar o computador.
          </Typography>
        </Panel>
        <Section
          title="Acesso pela rede"
          description="Outros computadores da rede abrem este endereço no navegador e entram com login e senha."
        >
          {status?.networkUrl ? (
            <SecretField
              label="Endereço na rede local"
              secret={status.networkUrl}
              copyLabel="Copiar endereço na rede"
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {status ? 'Nenhuma rede local detectada neste computador.' : 'Carregando…'}
            </Typography>
          )}
        </Section>
        <Section
          title="Cloudflare Tunnel"
          description="Publica o endereço do MCP e do atendimento na internet. Execute o túnel em apenas um computador."
        >
          <Typography variant="body2" data-testid="tunnel-status" sx={{ mb: 1 }}>
            {tunnelLabel(status)}
          </Typography>
          <Stack
            component="form"
            direction="row"
            spacing={1}
            onSubmit={(event) => {
              event.preventDefault();
              void saveTunnel();
            }}
          >
            <TextField
              label="Token do túnel"
              size="small"
              type="password"
              autoComplete="off"
              fullWidth
              value={token}
              placeholder="Cole o token do Cloudflare Tunnel"
              onChange={(event) => setToken(event.target.value)}
              slotProps={{ htmlInput: { required: true } }}
            />
            <Button type="submit" variant="contained" disabled={busy || !token.trim()}>
              Salvar e conectar
            </Button>
          </Stack>
          {notice && (
            <Typography variant="body2" sx={{ color: 'success.main', mt: 1 }}>
              {notice}
            </Typography>
          )}
        </Section>
        <Section
          title="Armazenamento local"
          description="O banco SQLite, as credenciais do WhatsApp e o token do túnel ficam nesta pasta."
        >
          <SecretField
            label="Pasta de dados"
            secret={status?.dataDir || ''}
            copyLabel="Copiar pasta de dados"
          />
        </Section>
        <Section
          title="Atualizações"
          description="O aplicativo verifica novas versões ao abrir e a cada seis horas, baixa e valida a assinatura."
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Versão instalada: {__APP_VERSION__}
          </Typography>
          {status?.updatesEnabled === false ? (
            <Typography variant="body2" color="text.secondary">
              Modo de desenvolvimento: atualizações desativadas.
            </Typography>
          ) : (
            <Button
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
            >
              Verificar atualizações
            </Button>
          )}
        </Section>
      </Stack>
    </SettingsC3Page>
  );
}
