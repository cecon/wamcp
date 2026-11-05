import { useState } from 'react';
import { http } from '../../api';
import { useAction } from '../useAction';

/** Replaces the token of a token-connected GitHub inbox; the server then creates the webhook. */
export function GithubTokenForm<T>({ inboxId, onSaved }: { inboxId: number; onSaved: (setup: T) => void }) {
  const [token, setToken] = useState('');
  const { error, busy, run } = useAction();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          onSaved(await http<T>(`/inboxes/${inboxId}/github/token`, 'PUT', { token }));
          setToken('');
        });
      }}
    >
      <label>
        <span className="field-label">Novo token do GitHub</span>
        <input
          className="field"
          type="password"
          autoComplete="off"
          placeholder="github_pat_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p className="text-xs text-n-slate-11">
        Fine-grained token com acesso a este repositório: Webhooks, Pull requests, Issues e Contents (leitura
        e escrita), Checks e Actions (leitura).
      </p>
      <button
        type="submit"
        className="self-start text-sm font-medium text-n-blue-11 disabled:opacity-50"
        disabled={busy || !token.trim()}
      >
        {busy ? 'Salvando…' : 'Salvar token e criar webhook'}
      </button>
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
    </form>
  );
}
