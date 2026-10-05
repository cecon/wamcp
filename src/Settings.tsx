import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
interface RuntimeStatus {
  tunnelConfigured: boolean;
  tunnelRunning: boolean;
  dataDir: string;
}
export function Settings() {
  const [token, setToken] = useState(''),
    [status, setStatus] = useState<RuntimeStatus | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [autostart, setAutostartState] = useState(false),
    [autostartMessage, setAutostartMessage] = useState('');
  useEffect(() => {
    if (isTauri())
      invoke<RuntimeStatus>('runtime_status')
        .then(setStatus)
        .catch((e) => setMessage(String(e)));
  }, []);
  useEffect(() => {
    if (isTauri())
      invoke<boolean>('autostart_status')
        .then(setAutostartState)
        .catch((e) => setAutostartMessage(String(e)));
  }, []);
  async function toggleAutostart(enabled: boolean) {
    try {
      await invoke('set_autostart', { enabled });
      setAutostartState(enabled);
      setAutostartMessage('');
    } catch (e) {
      setAutostartMessage(String(e));
    }
  }
  async function save() {
    setBusy(true);
    try {
      await invoke('configure_tunnel', { token });
      setToken('');
      setStatus(await invoke<RuntimeStatus>('runtime_status'));
      setMessage('Túnel configurado e iniciado.');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="heading">
        <div>
          <span className="eyebrow">DO SEU JEITO</span>
          <h1>Configurações</h1>
          <p>Conectividade e armazenamento do seu workspace.</p>
        </div>
      </div>
      <div className="panel prose">
        <h2>Atualizações automáticas</h2>
        <p>
          Versão instalada: {__APP_VERSION__}. O aplicativo verifica novas versões ao abrir e a cada seis
          horas, baixa e valida a assinatura automaticamente.
        </p>
        <p>
          Quando estiver pronta, use “Reiniciar e atualizar” no aviso. Suas sessões e conversas são
          preservadas.
        </p>
        <button
          className="primary"
          disabled={!isTauri()}
          onClick={() => window.dispatchEvent(new Event('wamcp:check-updates'))}
        >
          Verificar atualizações
        </button>
        <h2>Iniciar com o Windows</h2>
        <p>O WA MCP abre automaticamente ao ligar o computador, minimizado na bandeja.</p>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={autostart}
            disabled={!isTauri()}
            onChange={(e) => void toggleAutostart(e.target.checked)}
          />
          Iniciar automaticamente com o Windows
        </label>
        {autostartMessage && <div className="notice error">{autostartMessage}</div>}
        <h2>Cloudflare Tunnel</h2>
        <p>
          Endereço: <code>https://wamcp.cappyfy.com</code>
        </p>
        <p>
          {status?.tunnelRunning
            ? 'Conector em execução'
            : status?.tunnelConfigured
              ? 'Túnel configurado, conector parado'
              : 'Configure o token do túnel neste computador.'}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Token do túnel
            <input
              type="password"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Cole o token do Cloudflare Tunnel"
              autoComplete="off"
            />
          </label>
          <button className="primary" disabled={busy || !token.trim() || !isTauri()}>
            Salvar e conectar
          </button>
        </form>
        {message && <div className="notice">{message}</div>}
        <h2>Armazenamento local</h2>
        <p>O banco SQLite e as credenciais de sessão ficam no perfil do usuário do Windows.</p>
        <code className="path">{status?.dataDir || '%LOCALAPPDATA%\\com.cappyfy.wamcp'}</code>
        <p>
          O instalador não contém tokens nem históricos. Ao instalar em outro PC, configure o túnel e conecte
          suas contas novamente. Execute este túnel em apenas um computador com estas sessões.
        </p>
        <h2>Bandeja do Windows</h2>
        <p>
          Fechar a janela mantém as sessões e o túnel ativos. Use Abrir WA MCP para voltar ou Sair para
          encerrar.
        </p>
      </div>
    </>
  );
}
