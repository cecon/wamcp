import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export function UpdateNotice() {
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [installing, setInstalling] = useState(false);
  const checking = useRef(false);
  const check = useCallback(async (manual = false) => {
    if (!isTauri() || checking.current) return;
    checking.current = true;
    if (manual) setMessage('Verificando atualizações…');
    try {
      const update = await invoke<{ version: string } | null>('check_update');
      setVersion(update?.version || '');
      setMessage(
        update
          ? 'Atualização baixada e verificada. Suas sessões serão retomadas após reiniciar.'
          : manual
            ? 'Você está na versão mais recente.'
            : '',
      );
    } catch (error) {
      setMessage(manual ? String(error) : '');
    } finally {
      checking.current = false;
    }
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const initial = setTimeout(() => void check(), 10000);
    const interval = setInterval(() => void check(), 6 * 60 * 60 * 1000);
    const manual = () => void check(true);
    window.addEventListener('wamcp:check-updates', manual);
    const listener = listen<string>('update-downloading', (event) =>
      setMessage(`Baixando versão ${event.payload} em segundo plano…`),
    );
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener('wamcp:check-updates', manual);
      void listener.then((unlisten) => unlisten());
    };
  }, [check]);
  async function install() {
    setInstalling(true);
    setMessage('Instalando atualização. O aplicativo será reaberto automaticamente…');
    try {
      await invoke('install_update');
    } catch (error) {
      setVersion('');
      setMessage(String(error));
      setInstalling(false);
    }
  }
  if (!message) return null;
  return (
    <div className="notice update-notice" role="status">
      <div>
        {version && <strong>WA MCP {version} disponível</strong>}
        <p>{message}</p>
      </div>
      {version && (
        <button className="primary" disabled={installing} onClick={() => void install()}>
          {installing ? 'Instalando…' : 'Reiniciar e atualizar'}
        </button>
      )}
    </div>
  );
}
