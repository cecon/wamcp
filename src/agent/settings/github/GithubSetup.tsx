import { useState } from 'react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import type { GithubWebhook } from './WebhookInstructions';
import { WebhookInstructions } from './WebhookInstructions';

interface Setup extends GithubWebhook {
  account: string | null;
  hook_error?: string | null;
  via_app?: boolean;
}

/** The GitHub side of a GitHub inbox: repository, account that comments and the webhook. */
export function GithubSetup({ inboxId }: { inboxId: number }) {
  const setup = useFetch<Setup>(`/inboxes/${inboxId}/github`);
  const [retried, setRetried] = useState<Setup | null>(null);
  const { error, busy, run } = useAction();
  if (setup.error) return <p className="py-3 text-sm text-n-ruby-11">{setup.error}</p>;
  if (!setup.data) return null;
  const current = retried ?? setup.data;
  const { repo, account, hook_created } = current;
  return (
    <section className="flex flex-col gap-3 border-b border-n-weak py-4" aria-label="GitHub">
      <p className="text-sm text-n-slate-12">
        Repositório <strong>{repo}</strong>
        {account && (
          <>
            {' '}
            · o agente comenta como <strong>@{account}</strong>
          </>
        )}
      </p>
      {current.via_app ? (
        <p className="text-sm text-n-slate-11">
          Conectado pelo GitHub App: os eventos chegam pelo webhook do App.
        </p>
      ) : hook_created ? (
        <p className="text-sm text-n-slate-11">O webhook foi criado no GitHub pelo app.</p>
      ) : (
        <>
          <p className="text-sm font-medium text-n-amber-11">
            O webhook ainda não existe no GitHub: nenhum evento chega a esta caixa.
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="self-start text-sm font-medium text-n-blue-11 disabled:opacity-50"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setRetried(await http<Setup>(`/inboxes/${inboxId}/github/hook`, 'POST', {})),
                )
              }
            >
              {busy ? 'Criando…' : 'Criar webhook'}
            </button>
            <p className="text-xs text-n-slate-11">
              O token precisa da permissão Webhooks (leitura e escrita) no repositório. Ou cadastre à mão:
            </p>
            {error && <p className="text-sm text-n-ruby-11">{error}</p>}
          </div>
          <WebhookInstructions webhook={current} reason={current.hook_error} />
        </>
      )}
    </section>
  );
}
