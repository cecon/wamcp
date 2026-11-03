// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useState } from 'react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';
import type { GithubWebhook } from './WebhookInstructions';
import { WebhookInstructions } from './WebhookInstructions';

interface Setup extends GithubWebhook {
  account: string | null;
  hook_error?: string | null;
}

/** The GitHub side of a GitHub inbox: repository, account that comments and the webhook. */
export function GithubSetup({ inboxId }: { inboxId: number }) {
  const setup = useFetch<Setup>(`/inboxes/${inboxId}/github`);
  const [retried, setRetried] = useState<Setup | null>(null);
  const { error, busy, run } = useAction();
  if (setup.error)
    return (
      <Typography variant="body2" role="alert" sx={{ py: 1.5, color: 'error.main' }}>
        {setup.error}
      </Typography>
    );
  if (!setup.data) return null;
  const current = retried ?? setup.data;
  const { repo, account, hook_created } = current;
  return (
    <Box component="section" aria-label="GitHub" sx={{ borderBottom: 1, borderColor: 'divider', py: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="body2">
          Repositório <strong>{repo}</strong>
          {account && (
            <>
              {' '}
              · o agente comenta como <strong>@{account}</strong>
            </>
          )}
        </Typography>
        {hook_created ? (
          <Typography variant="body2" color="text.secondary">
            O webhook foi criado no GitHub pelo app.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" sx={{ fontWeight: 500, color: 'warning.main' }}>
              O webhook ainda não existe no GitHub: nenhum evento chega a esta caixa.
            </Typography>
            <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setRetried(await http<Setup>(`/inboxes/${inboxId}/github/hook`, 'POST', {})),
                  )
                }
              >
                {busy ? 'Criando…' : 'Criar webhook'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                O token precisa da permissão Webhooks (leitura e escrita) no repositório. Ou cadastre à mão:
              </Typography>
              {error && (
                <Typography variant="body2" sx={{ color: 'error.main' }}>
                  {error}
                </Typography>
              )}
            </Stack>
            <WebhookInstructions webhook={current} reason={current.hook_error} />
          </>
        )}
      </Stack>
    </Box>
  );
}
