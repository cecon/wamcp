import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { MessageSquare, Pause, Pencil, Play } from 'lucide-react';

// C3Theme
import { Panel, StatusChip } from '@c3theme/ui';

import C3Provider from '../c3/C3Provider';
import type { Route } from '../route';
import type { Catalog } from '../types';
import { StopButton } from '../agentRuns/LiveControls';
import { elapsed, KIND_LABEL, type AgentRun } from '../agentRuns/types';
import { AgentRosterModal } from '../settings/directory/AgentRosterModal';
import { roleLabel } from '../settings/directory/labels';
import { ActivityPanel } from '../settings/engine/ActivityPanel';
import { PermissionsPanel } from '../settings/engine/PermissionsPanel';
import { MemberAvatar } from '../settings/members/MemberAvatar';
import { useCustomRoles } from '../settings/roles/useCustomRoles';
import { AgentSections } from './AgentSections';
import { AttentionList } from './AttentionList';
import { attention, summarize } from './summary';
import { useAgentPage } from './useAgentPage';

interface Props {
  agentId: number;
  catalog: Catalog;
  /** As execuções em andamento de todos os agentes (`useAgentRuns`). */
  runs: AgentRun[];
  onNavigate: (route: Route) => void;
  onRunsChanged?: () => void;
}

/**
 * A página de um agente de IA. Em cima, o que importa: um resumo em frases e o que espera por você
 * (aprovações, erros, pausa e conversas passadas para pessoas, com o motivo). Embaixo, recolhidos, o
 * histórico, o que ele sabe fazer, a memória e o custo, e a configuração.
 */
export function AgentPage({ agentId, catalog, runs, onNavigate, onRunsChanged }: Props) {
  const data = useAgentPage(agentId, runs, onRunsChanged);
  const { roles: profiles } = useCustomRoles();
  const [activity, setActivity] = useState<number | null>(null),
    [editing, setEditing] = useState(false),
    [permissions, setPermissions] = useState(false);
  const { agent, controls, paused } = data;
  const openConversation = (displayId: number) => onNavigate({ page: 'conversations', displayId });
  const name = (id: number) => data.roster.find((a) => a.id === id)?.name ?? `#${id}`;

  if (!agent)
    return (
      <Box sx={{ p: 3 }}>
        <Typography color={data.error ? 'error' : 'text.secondary'}>
          {data.error || (data.loading ? 'Carregando…' : 'Agente não encontrado.')}
        </Typography>
      </Box>
    );
  if (agent.kind !== 'ai')
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">
          {agent.name} é uma pessoa; a página é dos agentes de IA.
        </Typography>
      </Box>
    );

  const input = {
    history: data.history,
    activities: data.activities,
    runs: data.runs,
    paused,
    monthBrl: data.salary?.salary_brl ?? null,
    now: data.now,
  };
  const sentences = summarize(input);
  const items = attention(input);
  const role = [...new Set([agent.profile_name, agent.role && roleLabel(agent.role)])]
    .filter(Boolean)
    .join(' · ');

  return (
    <C3Provider>
      <Box
        component="section"
        aria-label={`Página de ${agent.name}`}
        sx={{ p: { xs: 2, md: 3 }, maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={56} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h4" component="h1" noWrap>
              {agent.name}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {role || 'Agente de IA'}
              </Typography>
              {!agent.active && <StatusChip label="Inativo" tone="neutral" />}
            </Stack>
          </Box>
          {controls.admin && (
            <Button
              variant={paused ? 'contained' : 'outlined'}
              startIcon={paused ? <Play size={16} /> : <Pause size={16} />}
              disabled={controls.busy}
              onClick={() => void controls.setPaused(agent.id, !paused)}
            >
              {paused ? 'Retomar' : 'Pausar'}
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<MessageSquare size={16} />}
            onClick={() => onNavigate({ page: 'agent_chat', agentId: agent.id })}
          >
            Conversar
          </Button>
          <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setEditing(true)}>
            Editar
          </Button>
        </Stack>
        {(data.error || controls.error) && (
          <Typography color="error">{data.error || controls.error}</Typography>
        )}
        <Box component="section" aria-label="Resumo">
          <Panel>
            {sentences.map((s) => (
              <Typography key={s} variant="body1" sx={{ '& + &': { mt: 0.5 } }}>
                {s}
              </Typography>
            ))}
          </Panel>
        </Box>
        <AttentionList
          items={items}
          busy={controls.busy}
          onOpenActivity={setActivity}
          onOpenConversation={openConversation}
          onResume={controls.admin ? () => void controls.setPaused(agent.id, false) : undefined}
        />
        {data.runs.length > 0 && (
          <Box component="section" aria-label="Agora">
            <Panel title="Agora">
              {data.runs.map((run) => (
                <Box key={run.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ width: 96 }}>
                    {KIND_LABEL[run.kind]}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {run.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {run.detail ?? (run.state === 'queued' ? 'Aguardando vaga do runtime' : 'Pensando…')}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {elapsed(run.started_at ?? run.queued_at, data.now)}
                  </Typography>
                  {controls.admin && <StopButton controls={controls} run={run} />}
                </Box>
              ))}
            </Panel>
          </Box>
        )}
        <AgentSections
          data={data}
          inboxes={catalog.inboxes}
          onEdit={() => setEditing(true)}
          onPermissions={() => setPermissions(true)}
          onOpenActivity={setActivity}
          onOpenConversation={openConversation}
        />
      </Box>
      {activity !== null && (
        <ActivityPanel
          id={activity}
          name={name}
          onClose={() => setActivity(null)}
          onChanged={() => {
            data.reloadEngine();
            onRunsChanged?.();
          }}
        />
      )}
      {editing && (
        <AgentRosterModal
          agent={agent}
          kind={agent.kind}
          skills={data.skills}
          profiles={profiles}
          onManageAccess={() => setEditing(false)}
          onClose={() => setEditing(false)}
          onSaved={data.reload}
          onSkillsChanged={data.reloadSkills}
        />
      )}
      {permissions && <PermissionsPanel agents={[agent]} onClose={() => setPermissions(false)} />}
    </C3Provider>
  );
}
