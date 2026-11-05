// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { http } from '../api';
import type { RosterAgent } from '../adminTypes';
import type { Inbox } from '../types';
import { useFetch } from '../useFetch';
import { useAction } from './useAction';
import { executes, runtimeLabel } from './directory/labels';

interface Props {
  inbox: Inbox;
  onChange: () => Promise<void>;
}

/** Inbox setting "Agente de IA": the AI agent that answers new conversations through its runtime. */
export function InboxAgentSelect({ inbox, onChange }: Props) {
  const { data } = useFetch<RosterAgent[]>('/agent_directory');
  const { error, busy, run } = useAction();
  const agents = (data || []).filter(
    (a) => a.kind === 'ai' && !a.system && ((a.active && executes(a.role)) || a.id === inbox.ai_agent_id),
  );
  const connect = (value: string) =>
    run(async () => {
      await http(`/inboxes/${inbox.id}/ai_agent`, 'POST', { ai_agent_id: value ? Number(value) : null });
      await onChange();
    });

  return (
    <Box component="label" sx={{ display: 'block', borderTop: 1, borderColor: 'divider', py: 1.5 }}>
      <Typography component="span" variant="h6" sx={{ display: 'block' }}>
        Agente de IA
      </Typography>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        O agente responde as conversas novas pelo runtime e modelo do seu cadastro, com as suas instruções e
        skills. Elas ficam “Pendente” até ele transferir para a equipe. Conversas que já estão abertas
        continuam com quem as assumiu: para entregar uma ao agente, use “Passar para a IA” no menu de status
        da conversa. Coordenadores não atendem: só delegam.
      </Typography>
      <Box
        component="select"
        aria-label="Agente de IA"
        disabled={busy}
        value={inbox.ai_agent_id ? String(inbox.ai_agent_id) : ''}
        onChange={(e) => void connect(e.target.value)}
        sx={{
          height: 40,
          width: '100%',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.primary',
          px: 1,
        }}
      >
        <option value="">Nenhum</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {[agent.name, runtimeLabel(agent.runtime), agent.model].filter(Boolean).join(' · ')}
          </option>
        ))}
      </Box>
      {error && (
        <Typography
          component="span"
          variant="body2"
          sx={{ display: 'block', mt: 0.5, color: 'var(--color-n-ruby-11)' }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
}
