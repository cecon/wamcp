import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, sessionPath } from '../api';
import type { AccessToken, Audit } from '../types';
import { CopyButton } from '../ui';
import { ChatGptConnection } from './ChatGptConnection';
export function Credentials({ id, url }: { id: string; url: string }) {
  const [tokens, setTokens] = useState<AccessToken[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [name, setName] = useState(''),
    [scope, setScope] = useState('read'),
    [fresh, setFresh] = useState<AccessToken | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        api<AccessToken[]>(`${sessionPath(id)}/tokens`),
        api<Audit[]>(`${sessionPath(id)}/audit`),
      ]);
      setTokens(t);
      setAudit(a);
    } catch (e) {
      setError(String(e));
    }
  }, [id]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(initial);
  }, [refresh]);
  async function create() {
    setBusy(true);
    try {
      setFresh(await api<AccessToken>(`${sessionPath(id)}/tokens`, 'POST', { name, scope, days: 90 }));
      setName('');
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(tokenId: string) {
    try {
      await api(`${sessionPath(id)}/tokens/${tokenId}`, 'DELETE');
      if (fresh?.id === tokenId) setFresh(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  const config = JSON.stringify(
    {
      mcpServers: { whatsapp: { url, headers: { Authorization: `Bearer ${fresh?.token || 'SEU_TOKEN'}` } } },
    },
    null,
    2,
  );
  return (
    <div className="mcp-layout">
      <ChatGptConnection key={id} id={id} url={url} />
      {error && <div className="notice error">{error}</div>}
      <div className="panel">
        <div className="panel-title">
          <div>
            <h2>Outros clientes MCP</h2>
            <p>Credenciais Bearer para clientes com cabeçalhos personalizados.</p>
          </div>
          <ShieldCheck size={25} />
        </div>
        <label>Endereço MCP desta sessão</label>
        <div className="copy-field">
          <code>{url}</code>
          <CopyButton value={url} />
        </div>
        <div className="notice">
          Cada token acessa somente esta sessão. Gere uma credencial diferente para cada integração.
        </div>
        <h3>Credenciais de acesso</h3>
        <form
          className="token-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome da integração"
          />
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="read">Somente leitura</option>
            <option value="read_write">Leitura e envio</option>
          </select>
          <button className="primary" disabled={busy || !name.trim()}>
            <Plus size={16} />
            Gerar token
          </button>
        </form>
        {fresh && (
          <div className="token-reveal">
            <strong>Copie agora. Este token só aparece uma vez.</strong>
            <div className="copy-field">
              <code>{fresh.token}</code>
              <CopyButton value={fresh.token || ''} />
            </div>
            <small>
              Expira em {new Date(fresh.expires).toLocaleDateString('pt-BR')}. Guarde em um local seguro.
            </small>
            <button className="back" onClick={() => setFresh(null)}>
              Já copiei, ocultar token
            </button>
          </div>
        )}
        <div className="token-list">
          {tokens.map((t) => (
            <div className="token-row" key={t.id}>
              <KeyRound size={18} />
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.scope === 'read' ? 'Somente leitura' : 'Leitura e envio'} · Expira em{' '}
                  {new Date(t.expires).toLocaleDateString('pt-BR')}
                </small>
              </div>
              <button
                className="icon-button danger-text"
                title={`Revogar ${t.name}`}
                onClick={() => void revoke(t.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {tokens.length === 0 && (
            <p className="muted">
              Nenhuma credencial Bearer criada. As conexões do ChatGPT são gerenciadas acima.
            </p>
          )}
        </div>
      </div>
      <div className="panel">
        <h2>Configuração do cliente</h2>
        <p>Use em clientes que aceitam URL HTTP e cabeçalhos personalizados. Adapte o formato ao cliente.</p>
        <div className="code-block">
          <CopyButton value={config} />
          <pre>{config}</pre>
        </div>
        <h3>Ferramentas disponíveis</h3>
        <ul className="tool-list">
          <li>Estado da sessão</li>
          <li>Listagem de conversas</li>
          <li>Histórico e busca de mensagens</li>
          <li>Envio de texto, com permissão de envio</li>
        </ul>
        <h3>Atividade recente</h3>
        {audit.length ? (
          audit.slice(0, 8).map((a, i) => (
            <div className="audit-row" key={i}>
              <code>{a.action}</code>
              <small>{new Date(a.at).toLocaleString('pt-BR')}</small>
            </div>
          ))
        ) : (
          <p className="muted">As chamadas MCP aparecerão aqui.</p>
        )}
      </div>
    </div>
  );
}
