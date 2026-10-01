import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { api, sessionPath } from '../api';
import { CopyButton } from '../ui';
type Connection = { id: string; name: string; scope: string; expires: string };
type LinkCode = { code: string; expires: string };
export function ChatGptConnection({ id, url }: { id: string; url: string }) {
  const [scope, setScope] = useState('read');
  const [code, setCode] = useState<LinkCode | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setConnections(await api<Connection[]>(`${sessionPath(id)}/chatgpt`));
    } catch (e) {
      setError(String(e));
    }
  }, [id]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  async function generate() {
    setBusy(true);
    setError('');
    try {
      setCode(await api<LinkCode>(`${sessionPath(id)}/chatgpt/link`, 'POST', { scope }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(grant: string) {
    try {
      await api(`${sessionPath(id)}/chatgpt/${encodeURIComponent(grant)}`, 'DELETE');
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="panel chatgpt-panel">
      <div className="panel-title">
        <div>
          <h2>Conectar ao ChatGPT</h2>
          <p>
            Autorize esta sessão com um código temporário. O acesso é renovado automaticamente por até 90
            dias.
          </p>
        </div>
        <ShieldCheck size={25} />
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <ol className="chatgpt-steps">
        <li>
          No ChatGPT, ative o modo de desenvolvedor nas configurações, se disponível para sua conta ou
          workspace.
        </li>
        <li>
          Abra <strong>Plugins → +</strong>, crie a conexão WA MCP e cole o endereço abaixo. Escolha{' '}
          <strong>OAuth</strong>; deixe Client ID e Client Secret vazios para registro automático.
        </li>
        <li>
          Escolha a permissão e gere o código aqui. Na página de autorização aberta pelo ChatGPT, cole o
          código e confirme.
        </li>
      </ol>
      <label>URL do servidor MCP para o ChatGPT</label>
      <div className="copy-field">
        <code>{url}</code>
        <CopyButton value={url} />
      </div>
      <div className="token-form">
        <select aria-label="Permissão do ChatGPT" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="read">Somente leitura</option>
          <option value="read_write">Leitura e envio</option>
        </select>
        <button className="primary" disabled={busy} onClick={() => void generate()}>
          Gerar código para ChatGPT
        </button>
      </div>
      {code && (
        <div className="token-reveal">
          <strong>Código de uso único · válido por dez minutos</strong>
          <div className="copy-field">
            <code>{code.code}</code>
            <CopyButton value={code.code} />
          </div>
          <small>
            Expira às {new Date(code.expires).toLocaleTimeString('pt-BR')}. Cole somente na página de
            autorização de wamcp.cappyfy.com.
          </small>
          <button className="back" onClick={() => setCode(null)}>
            Ocultar código
          </button>
        </div>
      )}
      <h3>Conexões autorizadas</h3>
      {connections.length === 0 ? (
        <p className="muted">Nenhuma conexão OAuth autorizada nesta sessão.</p>
      ) : (
        connections.map((c) => (
          <div className="token-row" key={c.id}>
            <ShieldCheck size={18} />
            <div>
              <strong>{c.name}</strong>
              <small>
                {c.scope === 'read' ? 'Somente leitura' : 'Leitura e envio'} · Até{' '}
                {new Date(c.expires).toLocaleDateString('pt-BR')}
              </small>
            </div>
            <button
              className="icon-button danger-text"
              title={`Revogar conexão ${c.name}`}
              onClick={() => void revoke(c.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))
      )}
      <p className="muted">
        Mantenha o WA MCP aberto na bandeja e o túnel conectado. A criação do plugin no ChatGPT depende das
        opções disponíveis na sua conta.
      </p>
    </section>
  );
}
