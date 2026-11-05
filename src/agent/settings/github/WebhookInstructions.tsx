// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

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
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box
          component="code"
          sx={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            borderRadius: 1,
            bgcolor: 'action.hover',
            px: 1,
            py: 0.5,
          }}
        >
          {shown ? value : '•'.repeat(24)}
        </Box>
        {secret && (
          <Button size="small" onClick={() => setShown(!shown)}>
            {shown ? 'Ocultar' : 'Mostrar'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

/** How to add the webhook by hand on GitHub (Settings → Webhooks → Add webhook). */
export function WebhookInstructions({ webhook, reason }: { webhook: GithubWebhook; reason?: string | null }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        {reason ? `Não conseguimos criar o webhook (${reason}). ` : ''}
        No GitHub, abra o repositório em <strong>Settings → Webhooks → Add webhook</strong> e preencha:
      </Typography>
      <Field label="Payload URL" value={webhook.webhook_url} />
      <Field label="Content type" value="application/json" />
      <Field label="Secret" value={webhook.webhook_secret} secret />
      <Typography variant="body2" color="text.secondary">
        Em “Which events”, escolha “Let me select individual events” e marque: {webhook.events.join(', ')}.
      </Typography>
    </Stack>
  );
}
