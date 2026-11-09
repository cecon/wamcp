import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import type { AgentRun } from './types';
import { stopPath, type LiveControls } from './useLiveControls';

const STOP_TEXT: Record<string, string> = {
  conversation: 'O agente para de responder e a conversa passa para uma pessoa da caixa.',
  chat: 'A resposta em andamento é descartada.',
  engine: 'O pedido e o que ele delegou são cancelados.',
};

/** Pausar ou retomar um agente: pausado, ele não responde nem começa pedidos até ser retomado. */
export function PauseButton({
  controls,
  agentId,
  name,
}: {
  controls: LiveControls;
  agentId: number;
  name: string;
}) {
  const paused = controls.paused(agentId);
  const label = paused ? 'Retomar' : 'Pausar';
  return (
    <Button
      size="small"
      disabled={controls.busy}
      aria-label={`${label} ${name}`}
      onClick={() => void controls.setPaused(agentId, !paused)}
    >
      {label}
    </Button>
  );
}

/** "Encerrar" (resposta) ou "Cancelar" (motor), com confirmação. */
export function StopButton({ controls, run }: { controls: LiveControls; run: AgentRun }) {
  const [open, setOpen] = useState(false);
  if (!stopPath(run)) return null;
  const label = run.kind === 'engine' ? 'Cancelar' : 'Encerrar';
  return (
    <>
      <Button size="small" color="error" disabled={controls.busy} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>
          {label} “{run.title}”?
        </DialogTitle>
        <DialogContent>{STOP_TEXT[run.kind]}</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Voltar</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setOpen(false);
              void controls.stop(run);
            }}
          >
            {label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** Os agentes pausados que não têm sessão na tela, para poder retomá-los. */
export function PausedAgents({ controls, shown }: { controls: LiveControls; shown: Set<number> }) {
  const idle = controls.agents.filter((a) => a.paused && !shown.has(a.id));
  if (!idle.length) return null;
  return (
    <Paper variant="outlined" sx={{ mt: 3, px: 2, py: 1.5 }}>
      <Typography variant="subtitle2">Pausados</Typography>
      <Typography variant="caption" color="text.secondary" component="p">
        O que chegar para eles espera e é atendido quando forem retomados.
      </Typography>
      {idle.map((agent) => (
        <Box key={agent.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {agent.name}
          </Typography>
          <PauseButton controls={controls} agentId={agent.id} name={agent.name} />
        </Box>
      ))}
    </Paper>
  );
}
