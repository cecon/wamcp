// material-ui
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Inbox } from '../types';
import { runtimeLabel } from '../settings/directory/labels';
import { DetailCard, Overview, Settings, Skills, Tools } from '../settings/members/MemberDetailPanels';
import { skillIdsOf } from '../settings/members/format';
import { HistorySection } from './HistorySection';
import { MemorySection } from './MemorySection';
import { Section } from './Section';
import type { AgentPageData } from './useAgentPage';

interface Props {
  data: AgentPageData;
  inboxes: Inbox[];
  onEdit: () => void;
  onPermissions: () => void;
  onOpenActivity: (id: number) => void;
  onOpenConversation: (displayId: number) => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Os blocos recolhidos, embaixo do resumo: histórico, o que sabe fazer, memória e custo, configuração. */
export function AgentSections({
  data,
  inboxes,
  onEdit,
  onPermissions,
  onOpenActivity,
  onOpenConversation,
}: Props) {
  const agent = data.agent!;
  const detail = {
    agent,
    roster: data.roster,
    skills: data.skills,
    salary: data.salary,
    rates: data.rates,
    inboxes,
    onEdit,
    onClose: () => {},
    onChanged: data.reload,
  };
  const history = data.history;
  const counts = [
    plural(history?.conversations.length ?? 0, 'conversa', 'conversas'),
    plural(data.activities.length, 'pedido', 'pedidos'),
    plural(history?.schedule_runs.length ?? 0, 'rotina', 'rotinas'),
  ].join(' · ');
  return (
    <Stack spacing={1}>
      <Section title="Histórico" hint={counts}>
        <HistorySection
          history={history}
          activities={data.activities}
          onOpenActivity={onOpenActivity}
          onOpenConversation={onOpenConversation}
        />
      </Section>
      <Section title="O que sabe fazer" hint={plural(skillIdsOf(agent).length, 'skill', 'skills')}>
        <Typography variant="body2" color="text.secondary">
          As skills vêm dos plugins e do perfil; cada ferramenta ainda precisa da permissão do agente no
          motor.
        </Typography>
        <Skills agent={agent} skills={data.skills} />
        <Tools agent={agent} skills={data.skills} />
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={onEdit}>
            Editar skills
          </Button>
          <Button size="small" variant="outlined" onClick={onPermissions}>
            Permissões das ferramentas
          </Button>
        </Stack>
      </Section>
      <Section title="Memória e custo">
        <DetailCard title="Memória">
          <MemorySection agentId={agent.id} />
        </DetailCard>
        <Overview {...detail} />
      </Section>
      <Section
        title="Configuração"
        hint={`${runtimeLabel(agent.runtime)}${agent.model ? ` · ${agent.model}` : ''}`}
      >
        <DetailCard title="Instruções">
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {agent.instructions || 'Sem instruções próprias.'}
          </Typography>
        </DetailCard>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={onEdit}>
            Editar instruções e runtime
          </Button>
          <Button size="small" variant="outlined" onClick={onPermissions}>
            Autonomia e limites
          </Button>
        </Stack>
        <Settings {...detail} />
      </Section>
    </Stack>
  );
}
