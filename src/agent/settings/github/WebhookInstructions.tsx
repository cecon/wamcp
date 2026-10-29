import { useState } from 'react';

/** The webhook a GitHub inbox listens on (the secret signs every delivery). */
export interface GithubWebhook {
  repo?: string;
  webhook_url: string;
  webhook_secret: string;
  events: string[];
  hook_created: boolean;
}

function Field({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-n-alpha-2 px-2 py-1.5 text-xs text-n-slate-12">
          {shown ? value : '•'.repeat(24)}
        </code>
        {secret && (
          <button
            type="button"
            className="text-xs font-medium text-n-blue-11"
            onClick={() => setShown(!shown)}
          >
            {shown ? 'Ocultar' : 'Mostrar'}
          </button>
        )}
      </div>
    </div>
  );
}

/** How to add the webhook by hand on GitHub (Settings → Webhooks → Add webhook). */
export function WebhookInstructions({ webhook, reason }: { webhook: GithubWebhook; reason?: string | null }) {
  return (
    <div className="flex flex-col gap-3 text-sm text-n-slate-12">
      <p>
        {reason ? `Não conseguimos criar o webhook (${reason}). ` : ''}
        No GitHub, abra o repositório em <strong>Settings → Webhooks → Add webhook</strong> e preencha:
      </p>
      <Field label="Payload URL" value={webhook.webhook_url} />
      <Field label="Content type" value="application/json" />
      <Field label="Secret" value={webhook.webhook_secret} secret />
      <p className="text-n-slate-11">
        Em “Which events”, escolha “Let me select individual events” e marque: {webhook.events.join(', ')}.
      </p>
    </div>
  );
}
