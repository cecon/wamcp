// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { STATUS, type ActivityDetail, type EngineRecipient } from './types';

interface Props {
  detail: ActivityDetail;
  name: (agentId: number) => string;
}

const WHERE: Record<EngineRecipient['kind'], string> = {
  user: 'no chat com o agente',
  chat: 'no chat de onde veio o pedido',
  contact: 'no WhatsApp',
};

/** Who asked, if it was a person, a contact, an agent or a routine, when the raw requester is all there is. */
function requesterLabel(detail: ActivityDetail) {
  if (detail.requester_name) return detail.requester_name;
  const [kind, id] = detail.activity.requester.split(':');
  const label: Record<string, string> = {
    user: 'Pessoa',
    contact: 'Contato',
    agent: 'Agente',
    schedule: 'Rotina',
  };
  return `${label[kind] ?? kind} #${id}`;
}

function told(r: EngineRecipient) {
  if (r.error) return `não chegou: ${r.error}`;
  if (!r.last_event) return 'ainda não avisado';
  return `avisado: ${STATUS[r.last_event].toLowerCase()}`;
}

/**
 * A corrente do pedido em uma leitura: quem pediu, quem recebeu, para quem cada um delegou e para quem a
 * resposta foi (com o que cada um já soube). Os detalhes de cada atividade vêm embaixo.
 */
export function ChainSummary({ detail, name }: Props) {
  const root = detail.activity;
  const recipients = detail.recipients ?? [];
  const steps = [
    `${requesterLabel(detail)} pediu a ${name(root.agent_id)}.`,
    ...detail.delegations.map((d) => {
      const child = detail.tree.find((t) => t.activity.id === d.activity_id)?.activity;
      const state = child ? ` (${STATUS[child.status].toLowerCase()})` : '';
      return `${name(d.from_agent_id)} delegou a ${name(d.to_agent_id)}, pela skill ${d.skill}${state}.`;
    }),
  ];
  return (
    <Box
      component="section"
      aria-label="Corrente do pedido"
      sx={{
        borderRadius: 2,
        bgcolor: 'action.hover',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Typography variant="subtitle2" component="h3">
        Corrente do pedido
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
        {steps.map((s) => (
          <Typography key={s} component="li" variant="body2">
            {s}
          </Typography>
        ))}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        A resposta vai para:
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }} aria-label="Para quem vai a resposta">
        {root.conversation_id !== null && (
          <Typography component="li" variant="body2">
            O cliente, na conversa de origem ·{' '}
            {root.reply_state === 'sent' ? 'resposta enviada' : 'ainda sem resposta'}
          </Typography>
        )}
        {recipients.map((r) => (
          <Typography key={r.id} component="li" variant="body2">
            {r.name ?? `#${r.target_id}`} {WHERE[r.kind]}
            {r.copy ? ' (cópia)' : ''} ·{' '}
            <Typography component="span" variant="body2" color={r.error ? 'error' : 'text.secondary'}>
              {told(r)}
            </Typography>
          </Typography>
        ))}
        {root.conversation_id === null && recipients.length === 0 && (
          <Typography component="li" variant="body2" color="text.secondary">
            Ninguém: a resposta fica só no pedido.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
