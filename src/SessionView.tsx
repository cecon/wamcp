import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Link, LogOut, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, sessionPath } from './api';
import type { Session } from './types';
import { Status } from './ui';
import { Conversations } from './components/Conversations';
import { Credentials } from './components/Credentials';

export function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null),
    [tab, setTab] = useState('connect'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setSession(await api<Session>(sessionPath(id)));
    } catch (e) {
      setError(String(e));
    }
  }, [id]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  async function action(name: string) {
    setBusy(true);
    setError('');
    try {
      await api(`${sessionPath(id)}/${name}`, 'POST');
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <p>Carregando sessão…</p>;
  return (
    <>
      <button className="back" onClick={onBack}>
        <ArrowLeft size={16} />
        Todas as sessões
      </button>
      <div className="heading">
        <div>
          <span className="eyebrow">SESSÃO WHATSAPP</span>
          <h1>{session.name}</h1>
          <p>{session.phone ? `+${session.phone}` : 'Conecte uma conta para começar.'}</p>
        </div>
        <Status value={session.status} />
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="tabs">
        <button className={tab === 'connect' ? 'active' : ''} onClick={() => setTab('connect')}>
          <Link size={17} />
          Conexão
        </button>
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
          <MessageSquare size={17} />
          Conversas
        </button>
        <button className={tab === 'mcp' ? 'active' : ''} onClick={() => setTab('mcp')}>
          <ShieldCheck size={17} />
          Acesso MCP
        </button>
      </div>
      {tab === 'connect' ? (
        <div className="connection-layout">
          <div className="panel">
            <h2>Conecte seu WhatsApp</h2>
            <p>Vincule esta sessão como um aparelho conectado.</p>
            <ol className="instructions">
              <li>Abra o WhatsApp no seu celular.</li>
              <li>
                Acesse <strong>Aparelhos conectados</strong>.
              </li>
              <li>
                Toque em <strong>Conectar aparelho</strong> e leia o QR Code.
              </li>
            </ol>
            <div className="button-row">
              <button
                className="primary"
                disabled={
                  busy ||
                  session.status === 'connected' ||
                  session.status === 'qr' ||
                  session.status === 'connecting'
                }
                onClick={() => void action('connect')}
              >
                <RefreshCw size={16} />
                {session.status === 'connected' ? 'WhatsApp conectado' : 'Conectar WhatsApp'}
              </button>
              {['connected', 'qr', 'connecting', 'reconnecting'].includes(session.status) && (
                <button className="secondary" disabled={busy} onClick={() => void action('disconnect')}>
                  Desconectar
                </button>
              )}
            </div>
            <details className="danger-details">
              <summary>Desvincular conta</summary>
              <p>
                Encerra o vínculo com o celular e apaga as credenciais de conexão. O histórico local
                permanece.
              </p>
              <button className="danger" disabled={busy} onClick={() => void action('logout')}>
                <LogOut size={15} />
                Desvincular WhatsApp
              </button>
            </details>
          </div>
          <div className="panel qr-panel">
            {session.qr ? (
              <img src={session.qr} alt="QR Code para conectar o WhatsApp" />
            ) : (
              <div className={`qr-placeholder ${session.status === 'connected' ? 'connected' : ''}`}>
                <MessageSquare size={64} />
                <h3>
                  {session.status === 'connected'
                    ? 'Tudo conectado'
                    : session.status === 'connecting'
                      ? 'Preparando QR Code…'
                      : 'Pronto para conectar'}
                </h3>
                <p>
                  {session.status === 'connected'
                    ? 'Sua sessão está disponível para integrações.'
                    : 'Clique em Conectar WhatsApp para gerar o QR Code.'}
                </p>
              </div>
            )}
            <small>
              {session.qr
                ? 'O QR Code é atualizado automaticamente.'
                : 'Sua conexão é salva neste computador.'}
            </small>
          </div>
        </div>
      ) : tab === 'chats' ? (
        <Conversations id={id} />
      ) : (
        <Credentials id={id} url={session.mcpUrl || ''} />
      )}
    </>
  );
}
