import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  MessageSquare,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api, setBrowserToken } from './api';
import type { Session } from './types';
import { Logo } from './ui';
import { Help } from './components/Help';
import { Dashboard } from './components/Dashboard';
import { SessionView } from './SessionView';
import { Settings } from './Settings';
import { UpdateNotice } from './components/UpdateNotice';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState('sessions'),
    [error, setError] = useState(''),
    [modal, setModal] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [previewToken, setPreviewToken] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSessions(await api<Session[]>('/api/sessions'));
      setReady(true);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  async function create() {
    setBusy(true);
    try {
      const s = await api<Session>('/api/sessions', 'POST', { name });
      await refresh();
      setSelected(s.id);
      setModal(false);
      setName('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            WA MCP<span>by cappyfy</span>
          </div>
        </div>
        <div className="workspace-label">
          WORKSPACE <span>LOCAL</span>
        </div>
        <nav>
          <button
            className={page === 'sessions' ? 'active' : ''}
            onClick={() => {
              setPage('sessions');
              setSelected(null);
            }}
          >
            <LayoutDashboard size={19} />
            Minhas sessões<span>{sessions.length}</span>
          </button>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
            <Settings2 size={19} />
            Configurações
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="private">
            <ShieldCheck size={18} />
            <div>
              Seus dados, no seu PC<small>Histórico armazenado localmente</small>
            </div>
          </div>
          <button className="help-link" onClick={() => setPage('help')}>
            <CircleHelp size={17} />
            Como funciona
            <ArrowUpRight size={15} />
          </button>
          <div className="profile">
            <div className="avatar">C</div>
            <div>
              Cappyfy Workspace<small>WA MCP · v{__APP_VERSION__}</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <strong>
              {selected && page === 'sessions'
                ? 'Detalhes da sessão'
                : page === 'settings'
                  ? 'Configurações'
                  : page === 'help'
                    ? 'Como funciona'
                    : 'Minhas sessões'}
            </strong>
          </div>
          <span>
            <i className={ready ? 'online-dot' : 'offline-dot'} />
            {ready ? 'Serviço local ativo' : 'Iniciando serviço'}
          </span>
        </header>
        <div className="content">
          <UpdateNotice />
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {!ready && !isTauri() && (
            <form
              className="notice preview-login"
              onSubmit={(e) => {
                e.preventDefault();
                setBrowserToken(previewToken);
                void refresh();
              }}
            >
              <label>
                Prévia de desenvolvimento: token administrativo local
                <input
                  type="password"
                  value={previewToken}
                  onChange={(e) => setPreviewToken(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button className="primary">Entrar</button>
            </form>
          )}
          {page === 'settings' ? (
            <Settings />
          ) : page === 'help' ? (
            <Help />
          ) : selected ? (
            <SessionView
              id={selected}
              onBack={() => {
                setSelected(null);
                void refresh();
              }}
            />
          ) : (
            <Dashboard sessions={sessions} onCreate={() => setModal(true)} onSelect={setSelected} />
          )}
        </div>
        <footer>
          Construído para conectar. Feito para você controlar.<span>CAPPYFY / WA MCP</span>
        </footer>
      </main>
      {modal && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <button type="button" className="close" onClick={() => setModal(false)} aria-label="Fechar">
              <X size={19} />
            </button>
            <div className="session-icon">
              <MessageSquare size={25} />
            </div>
            <h2>Uma nova conexão</h2>
            <p>Dê um nome à sessão para identificar esta conta.</p>
            <label>
              Nome da sessão
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Atendimento Cappyfy"
                maxLength={80}
                required
              />
            </label>
            <button className="primary full" disabled={busy || !name.trim()}>
              {busy ? 'Criando…' : 'Criar sessão'}
              <ChevronRight size={17} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
