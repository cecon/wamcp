import { useFetch } from '../../useFetch';
import type { GithubWebhook } from './WebhookInstructions';
import { WebhookInstructions } from './WebhookInstructions';

interface Setup extends GithubWebhook {
  account: string | null;
}

/** The GitHub side of a GitHub inbox: repository, account that comments and the webhook. */
export function GithubSetup({ inboxId }: { inboxId: number }) {
  const setup = useFetch<Setup>(`/inboxes/${inboxId}/github`);
  if (setup.error) return <p className="py-3 text-sm text-n-ruby-11">{setup.error}</p>;
  if (!setup.data) return null;
  const { repo, account, hook_created } = setup.data;
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
      {hook_created ? (
        <p className="text-sm text-n-slate-11">O webhook foi criado no GitHub pelo app.</p>
      ) : (
        <WebhookInstructions webhook={setup.data} />
      )}
    </section>
  );
}
