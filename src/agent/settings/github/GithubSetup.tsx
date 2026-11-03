// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useFetch } from '../../useFetch';
import type { GithubWebhook } from './WebhookInstructions';
import { WebhookInstructions } from './WebhookInstructions';

interface Setup extends GithubWebhook {
  account: string | null;
}

/** The GitHub side of a GitHub inbox: repository, account that comments and the webhook. */
export function GithubSetup({ inboxId }: { inboxId: number }) {
  const setup = useFetch<Setup>(`/inboxes/${inboxId}/github`);
  if (setup.error)
    return (
      <Typography variant="body2" role="alert" sx={{ py: 1.5, color: 'error.main' }}>
        {setup.error}
      </Typography>
    );
  if (!setup.data) return null;
  const { repo, account, hook_created } = setup.data;
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
          <WebhookInstructions webhook={setup.data} />
        )}
      </Stack>
    </Box>
  );
}
