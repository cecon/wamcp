import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError, http } from '../api';
import { authError, type Me } from './authError';
import { Button } from '../ui/Button';

interface Props {
  token: string;
  onLogin: (me: Me) => void;
  /** Back to e-mail and password (cancelled, or the challenge expired). */
  onRestart: (message: string) => void;
}

/** Second login step (Chatwoot MfaVerification): a TOTP code or a backup code. */
export function MfaStep({ token, onLogin, onRestart }: Props) {
  const [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="w-full max-w-md bg-white p-8 sm:rounded-lg sm:p-11 sm:shadow-lg"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        http<Me>('/auth/mfa', 'POST', { mfa_token: token, code: code.trim() })
          .then(onLogin)
          .catch((err: unknown) => {
            // Expired challenges (5 minutes or 5 wrong codes) need the password again.
            if (err instanceof ApiError && err.status === 401 && /expirad/i.test(err.message))
              return onRestart(err.message);
            setError(authError(err));
            setCode('');
          })
          .finally(() => setBusy(false));
      }}
    >
      <span className="mb-6 flex size-10 items-center justify-center rounded-xl bg-n-brand text-white">
        <ShieldCheck size={22} />
      </span>
      <h1 className="text-2xl font-semibold text-n-slate-12">Verificação em duas etapas</h1>
      <p className="mt-2 text-sm text-n-slate-11">
        Insira o código de 6 dígitos do aplicativo autenticador ou um dos seus códigos de recuperação.
      </p>
      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="field-label">Código de verificação</span>
          <input
            className="field font-mono tracking-widest"
            value={code}
            placeholder="000000"
            autoComplete="one-time-code"
            maxLength={20}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && (
          <p className="text-sm text-n-ruby-11" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="md"
          className="w-full"
          disabled={busy || !code.trim()}
          label={busy ? 'Verificando…' : 'Verificar'}
        />
        <Button
          color="slate"
          variant="link"
          className="w-full"
          label="Cancelar e voltar para o login"
          onClick={() => onRestart('')}
        />
      </div>
    </form>
  );
}
