import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { SecretField } from '../../ui/SecretField';
import { SettingsHeader, SettingsPage, Toggle } from '../../ui/Settings';
import { NoAccess } from '../../ui/NoAccess';
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
    <section className="flex flex-col gap-3 border-t border-n-weak pt-6" aria-label={title}>
      <div>
        <h2 className="text-heading-3 text-n-slate-12">{title}</h2>
        <p className="text-sm text-n-slate-11">{description}</p>
      </div>
      {children}
    </section>
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
    <SettingsPage>
      <SettingsHeader
        title="Aplicativo"
        description="Configurações deste computador: início automático, túnel, acesso pela rede e atualizações."
      />
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <div className="flex max-w-2xl flex-col gap-6">
        <Toggle
          label="Iniciar com o Windows"
          hint="Abre o WA MCP minimizado na bandeja ao ligar o computador."
          checked={autostart}
          onChange={(v) => void toggleAutostart(v)}
        />
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
            <p className="text-sm text-n-slate-11">
              {status ? 'Nenhuma rede local detectada neste computador.' : 'Carregando…'}
            </p>
          )}
        </Section>
        <Section
          title="Cloudflare Tunnel"
          description="Publica o endereço do MCP e do atendimento na internet. Execute o túnel em apenas um computador."
        >
          <p className="text-sm text-n-slate-12" data-testid="tunnel-status">
            {tunnelLabel(status)}
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveTunnel();
            }}
          >
            <label className="flex-1">
              <span className="field-label">Token do túnel</span>
              <input
                className="field"
                type="password"
                required
                autoComplete="off"
                value={token}
                placeholder="Cole o token do Cloudflare Tunnel"
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <Button type="submit" size="md" label="Salvar e conectar" disabled={busy || !token.trim()} />
          </form>
          {notice && <p className="text-sm text-n-teal-11">{notice}</p>}
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
          <p className="text-sm text-n-slate-12">Versão instalada: {__APP_VERSION__}</p>
          {status?.updatesEnabled === false ? (
            <p className="text-sm text-n-slate-11">Modo de desenvolvimento: atualizações desativadas.</p>
          ) : (
            <Button
              color="slate"
              className="self-start"
              label="Verificar atualizações"
              onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
            />
          )}
        </Section>
      </div>
    </SettingsPage>
  );
}
