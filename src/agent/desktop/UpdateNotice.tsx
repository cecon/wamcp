import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Download, X } from 'lucide-react';
import { Button } from '../ui/Button';
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
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl bg-n-solid-2 p-4 text-sm shadow-lg outline outline-1 outline-n-container"
    >
      <Download size={18} className="mt-0.5 shrink-0 text-n-blue-11" />
      <div className="min-w-0 flex-1">
        {version && <p className="font-medium text-n-slate-12">WA MCP {version} disponível</p>}
        <p className="text-n-slate-11">{message}</p>
        {version && (
          <Button
            className="mt-3"
            disabled={installing}
            label={installing ? 'Instalando…' : 'Reiniciar e atualizar'}
            onClick={() => void install()}
          />
        )}
      </div>
      {!installing && (
        <Button
          variant="ghost"
          color="slate"
          size="xs"
          icon={X}
          aria-label="Fechar aviso de atualização"
          onClick={() => setMessage('')}
        />
      )}
    </div>
  );
}
