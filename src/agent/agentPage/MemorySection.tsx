// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import { useAction } from '../settings/useAction';
import { useFetch } from '../useFetch';
import { MEMORY_KIND, type EngineMemory } from './types';

/** O que o agente guardou no motor (fatos, conhecimento, jeito de trabalhar), com a opção de apagar. */
export function MemorySection({ agentId }: { agentId: number }) {
  const { data, error, reload } = useFetch<EngineMemory[]>(`/engine/agents/${agentId}/memories`);
  const action = useAction();
  const forget = (id: number) =>
    void action.run(async () => {
      await http(`/engine/memories/${id}`, 'DELETE');
      reload();
    });
  if (error)
    return (
      <Typography variant="body2" color="text.secondary">
        A memória vem do motor de agentes: {error}
      </Typography>
    );
  if (!data)
    return (
      <Typography variant="body2" color="text.secondary">
        Carregando…
      </Typography>
    );
  if (!data.length)
    return (
      <Typography variant="body2" color="text.secondary">
        Nada guardado ainda. O agente grava aqui o que aprende nos pedidos do motor.
      </Typography>
    );
  return (
    <Box
      component="ul"
      sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      {data.map((m) => (
        <Box
          key={m.id}
          component="li"
          sx={{
            display: 'flex',
            gap: 1.5,
            alignItems: 'flex-start',
            borderRadius: 2,
            bgcolor: 'var(--color-n-alpha-2)',
            px: 1.5,
            py: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {m.content}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {MEMORY_KIND[m.kind] ?? m.kind}
              {m.visibility === 'organization' ? ' · visível para a organização' : ' · só dele'}
              {m.source ? ` · ${m.source}` : ''}
            </Typography>
          </Box>
          <Button size="small" color="error" disabled={action.busy} onClick={() => forget(m.id)}>
            Apagar
          </Button>
        </Box>
      ))}
      {action.error && (
        <Typography role="alert" variant="body2" color="error">
          {action.error}
        </Typography>
      )}
    </Box>
  );
}
