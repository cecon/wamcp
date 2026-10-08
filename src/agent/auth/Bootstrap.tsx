import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError, firstRun, http } from '../api';
import { Button } from '../ui/Button';
import { authError, type LoginResult } from './authError';

interface Props {
  onSignedIn: (result: LoginResult) => void;
  /** The administrator exists (created now or meanwhile): back to the usual login with a message. */
  onExists: (message: string) => void;
}

const FIELDS = [
  { key: 'name', label: 'Nome', type: 'text', autoComplete: 'name' },
  { key: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
  { key: 'password', label: 'Senha (mínimo 10 caracteres)', type: 'password', autoComplete: 'new-password' },
  { key: 'confirm', label: 'Confirmar senha', type: 'password', autoComplete: 'new-password' },
] as const;
type Form = Record<(typeof FIELDS)[number]['key'], string>;

/** First run on this computer: creates the first administrator, then signs in with it. */
export function Bootstrap({ onSignedIn, onExists }: Props) {
  const [form, setForm] = useState<Form>({ name: '', email: '', password: '', confirm: '' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit() {
    if (form.password.length < 10) return setError('A senha precisa ter pelo menos 10 caracteres.');
    if (form.password !== form.confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError('');
    const account = { name: form.name.trim(), email: form.email.trim(), password: form.password };
    try {
      await firstRun('/bootstrap', 'POST', account);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409)
        return onExists('Já existe um administrador. Entre com o e-mail e a senha.');
      return setError(authError(err));
    }
    try {
      onSignedIn(
        await http<LoginResult>('/auth/login', 'POST', { email: account.email, password: form.password }),
      );
    } catch (err) {
      // The account exists: the usual login screen takes over.
      onExists(authError(err));
    }
  }
  return (
    <form
      className="w-full max-w-md bg-n-solid-1 p-8 sm:rounded-lg sm:p-11 sm:shadow-lg"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <span className="mb-6 flex size-10 items-center justify-center rounded-xl bg-n-brand text-white">
        <ShieldCheck size={22} />
      </span>
      <h1 className="text-2xl font-semibold text-n-slate-12">Criar administrador</h1>
      <p className="mt-2 text-sm text-n-slate-11">
        Primeiro acesso ao WA MCP. Esta conta conecta o WhatsApp e cadastra os demais agentes.
      </p>
      <div className="mt-8 space-y-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="field-label">{f.label}</span>
            <input
              className="field"
              type={f.type}
              autoComplete={f.autoComplete}
              value={form[f.key]}
              maxLength={f.key === 'name' ? 80 : 200}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              required
            />
          </label>
        ))}
        {error && (
          <p className="text-sm text-n-ruby-11" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="md"
          className="w-full"
          disabled={busy}
          label={busy ? 'Criando…' : 'Criar administrador'}
        />
      </div>
    </form>
  );
}
