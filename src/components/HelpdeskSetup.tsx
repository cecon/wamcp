import { useEffect, useState } from 'react';
import { Headset, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { CopyButton } from '../ui';

interface Status {
  needsBootstrap: boolean;
  webUrl: string;
}

/** Desktop-only step: create the first helpdesk administrator and share the agent web address. */
export function HelpdeskSetup() {
  const [status, setStatus] = useState<Status | null>(null),
    [form, setForm] = useState({ name: '', email: '', password: '' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Status>('/api/helpdesk/status')
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);
  async function bootstrap() {
    setBusy(true);
    setError('');
    try {
      await api('/api/helpdesk/bootstrap', 'POST', form);
      setStatus((s) => (s ? { ...s, needsBootstrap: false } : s));
      setForm({ name: '', email: '', password: '' });
    } catch {
      setError(
        'Não foi possível criar o administrador. Verifique o e-mail e use uma senha com 10+ caracteres.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="heading">
        <div>
          <span className="eyebrow">EM EQUIPE</span>
          <h1>Atendimento</h1>
          <p>
            Caixa de entrada compartilhada para sua equipe responder o WhatsApp, com agentes, times e
            etiquetas.
          </p>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {status?.needsBootstrap ? (
        <form
          className="panel prose helpdesk-form"
          onSubmit={(e) => {
            e.preventDefault();
            void bootstrap();
          }}
        >
          <h2>
            <ShieldCheck size={19} /> Criar o primeiro administrador
          </h2>
          <p>
            Esta conta entra no painel web e cadastra os demais agentes. Só pode ser criada aqui no
            computador.
          </p>
          <label>
            Nome
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label>
            Senha (mínimo 10 caracteres)
            <input
              type="password"
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Criando…' : 'Criar administrador'}
          </button>
        </form>
      ) : (
        status && (
          <div className="panel prose">
            <h2>
              <Headset size={19} /> Painel dos agentes
            </h2>
            <p>
              Compartilhe este endereço com a equipe. Cada agente entra com o e-mail e a senha cadastrados.
            </p>
            <p className="helpdesk-url">
              <code>{status.webUrl}</code>
              <CopyButton value={status.webUrl} />
            </p>
            <p>O app precisa estar aberto e com o conector ativo para o painel ficar acessível.</p>
          </div>
        )
      )}
    </>
  );
}
