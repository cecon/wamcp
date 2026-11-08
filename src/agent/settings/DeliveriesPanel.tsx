// material-ui
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { X } from 'lucide-react';

import { formatTime } from '../api';
import type { Delivery } from '../types';
import { WEBHOOK_EVENTS } from '../labels';

const STATUS: Record<Delivery['status'], [string, string]> = {
  pending: ['pendente', 'warning.main'],
  sent: ['entregue', 'success.main'],
  failed: ['falhou', 'error.main'],
};

interface Props {
  /** Destination shown under the title (webhook or bot URL). */
  target: string;
  list: Delivery[];
  onClose: () => void;
}

/** Recent deliveries of a webhook or agent bot: event, time, status and attempts. */
export function DeliveriesPanel({ target, list, onClose }: Props) {
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Entregas recentes
        <IconButton size="small" aria-label="Fechar" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, wordBreak: 'break-all' }}>
          {target}
        </Typography>
        {list.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nenhuma entrega ainda.
          </Typography>
        )}
        <Stack divider={<hr />} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {list.map((d) => (
            <Stack
              component="li"
              key={d.id}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1 }}
            >
              <Typography variant="body2">
                <Typography component="span" sx={{ fontWeight: 600 }}>
                  {WEBHOOK_EVENTS[d.event] || d.event}
                </Typography>
                <Typography component="span" variant="body2" color="text.secondary">
                  {' '}
                  · {formatTime(d.created_at)}
                </Typography>
              </Typography>
              <Typography variant="body2" sx={{ color: STATUS[d.status][1], textAlign: 'right' }}>
                {STATUS[d.status][0]} ({d.attempts}x){d.last_error ? ` · ${d.last_error}` : ''}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
