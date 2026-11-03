// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useFetch } from '../../useFetch';

/** One delivery GitHub attempted: what it sent and the HTTP status the app answered. */
export interface GithubDelivery {
  id: number;
  event: string;
  action?: string | null;
  status?: number | null;
  duration_ms?: number | null;
  delivered_at?: string | null;
  redelivery?: boolean;
}

interface Answer {
  hook_created: boolean;
  deliveries: GithubDelivery[];
}

function when(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
}

/**
 * O que o GitHub mandou para o webhook desta caixa, com o status de cada entrega — a prova de que o
 * canal está recebendo (o primeiro item é o `ping` que o GitHub envia ao criar o webhook).
 */
export function GithubDeliveries({
  inboxId,
  title = 'Entregas do GitHub',
}: {
  inboxId: number;
  title?: string;
}) {
  const answer = useFetch<Answer>(`/inboxes/${inboxId}/github/deliveries`);
  return (
    <Box component="section" aria-label={title} sx={{ py: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Button size="small" onClick={answer.reload}>
          Atualizar
        </Button>
      </Stack>
      {answer.error && (
        <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
          {answer.error}
        </Typography>
      )}
      {answer.data && !answer.data.hook_created && (
        <Typography variant="body2" color="text.secondary">
          Crie o webhook para o GitHub começar a enviar eventos.
        </Typography>
      )}
      {answer.data?.hook_created && answer.data.deliveries.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nenhuma entrega ainda. O GitHub manda um evento de teste (ping) assim que o webhook é criado.
        </Typography>
      )}
      {answer.data?.hook_created && answer.data.deliveries.length > 0 && (
        <Stack divider={<Divider flexItem />} spacing={1}>
          {answer.data.deliveries.map((d) => (
            <Stack
              key={d.id}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {d.event}
                  {d.action ? ` · ${d.action}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {when(d.delivered_at)}
                  {d.redelivery ? ' · reenvio' : ''}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={d.status ? `HTTP ${d.status}` : 'sem resposta'}
                color={d.status && d.status >= 200 && d.status < 300 ? 'success' : 'error'}
                variant="outlined"
              />
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
