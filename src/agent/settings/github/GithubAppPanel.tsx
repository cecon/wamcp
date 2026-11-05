import { useState } from 'react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';

interface AppStatus {
  app: { slug: string; owner: string | null; html_url: string; install_url: string } | null;
  repos: { inbox_id: number; repo: string }[];
}

const link = 'text-sm font-medium text-n-blue-11 underline';

/**
 * The agents' own GitHub identity (`name[bot]`): created from a manifest GitHub fills in, then
 * installed on repositories; each one becomes a GitHub channel. Hidden from non-administrators.
 */
export function GithubAppPanel() {
  const status = useFetch<AppStatus>('/github_app');
  const [owner, setOwner] = useState(''),
    [next, setNext] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  if (!status.data) return null;
  const { app, repos } = status.data;
  return (
    <section className="mb-6 flex flex-col gap-3 rounded-xl border border-n-weak p-4" aria-label="GitHub App">
      <h2 className="text-heading-3 text-n-slate-12">GitHub App do agente</h2>
      {app ? (
        <>
          <p className="text-sm text-n-slate-12">
            O agente age no GitHub como <strong>@{app.slug}[bot]</strong>
            {app.owner && <> (de {app.owner})</>}. Cada repositório em que o App estiver instalado vira um
            canal, e os eventos chegam pelo webhook do App.
          </p>
          <a className={link} href={app.install_url} target="_blank" rel="noreferrer">
            Instalar ou escolher repositórios no GitHub
          </a>
          {repos.length > 0 ? (
            <p className="text-sm text-n-slate-11">Repositórios: {repos.map((r) => r.repo).join(', ')}</p>
          ) : (
            <p className="text-sm text-n-slate-11">Ainda não instalado em nenhum repositório.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-n-slate-12">
            Dê ao agente uma identidade própria no GitHub, em vez do seu token pessoal: o GitHub abre com o
            App preenchido (permissões, eventos e webhook), você confirma e escolhe os repositórios.
          </p>
          <label>
            <span className="field-label">Organização (opcional; vazio cria na sua conta)</span>
            <input
              className="field"
              placeholder="ex.: minha-empresa"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          {next ? (
            <a className={link} href={next} target="_blank" rel="noreferrer">
              Abrir o GitHub para criar o App
            </a>
          ) : (
            <button
              type="button"
              className="self-start text-sm font-medium text-n-blue-11 disabled:opacity-50"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const started = await http<{ url: string }>('/github_app', 'POST', {
                    owner: owner.trim() || null,
                  });
                  setNext(started.url);
                })
              }
            >
              {busy ? 'Preparando…' : 'Criar GitHub App'}
            </button>
          )}
          {error && <p className="text-sm text-n-ruby-11">{error}</p>}
        </>
      )}
    </section>
  );
}
