import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { Bot, UserRound } from 'lucide-react';

import { http } from '../../api';
import type { RosterAgent, RosterKind, SalarySheet, Skill } from '../../adminTypes';
import type { Catalog, User } from '../../types';
import { useFetch } from '../../useFetch';
import { ConfirmModal } from '../../ui/Confirm';
import { AgentModal } from '../AgentModal';
import { useCustomRoles } from '../roles/useCustomRoles';
import { SettingsC3Error, SettingsC3Header } from '../c3/SettingsC3';
import { MemberCard } from '../members/MemberCard';
import { MemberDetail } from '../members/MemberDetail';
import { brl } from '../members/format';
import { AgentRosterModal } from './AgentRosterModal';

interface Props {
  user: User;
  catalog: Catalog;
  /** Reloads the catalog (logins are part of it). */
  onChange: () => Promise<void>;
}

type Filter = 'all' | RosterKind;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'human', label: 'Pessoas' },
  { value: 'ai', label: 'Agentes de IA' },
];

/**
 * "Funcionários": every member in one grid — people (with or without a helpdesk login) and AI agents,
 * each with a profile — with the month's salaries and a detail pane for the selected one.
 */
export function RosterSection({ user, catalog, onChange }: Props) {
  const { data, error, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const { data: skills, reload: reloadSkills } = useFetch<Skill[]>('/skills');
  const { data: fetched, reload: reloadSheet } = useFetch<SalarySheet>('/agent_directory/salaries');
  // Salaries are extra information: anything but a sheet (an older server) just hides them.
  const sheet = Array.isArray(fetched?.salaries) ? fetched : null;
  const { roles: profiles } = useCustomRoles();
  const [editing, setEditing] = useState<{ agent: RosterAgent | null; kind: RosterKind } | null>(null),
    [access, setAccess] = useState<User | null>(null),
    [removing, setRemoving] = useState<RosterAgent | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [filter, setFilter] = useState<Filter>('all'),
    [search, setSearch] = useState('');
  const agents = data || [];
  const changed = async () => {
    reload();
    reloadSheet();
    await onChange();
  };
  const salaryOf = (id: number) => sheet?.salaries.find((s) => s.agent_id === id);
  const term = search.trim().toLowerCase();
  const shown = agents.filter(
    (a) =>
      (filter === 'all' || a.kind === filter) &&
      (!term || `${a.name} ${a.profile_name ?? ''}`.toLowerCase().includes(term)),
  );
  const detail = agents.find((a) => a.id === selected);
  const total = (kind?: RosterKind) =>
    (sheet?.salaries || []).filter((s) => !kind || s.kind === kind).reduce((sum, s) => sum + s.salary_brl, 0);

  return (
    <>
      <SettingsC3Header
        title="Funcionários"
        description="Pessoas e agentes de IA, com as mesmas funções: coordenadores delegam; operadores, suporte dev e QA executam com as suas skills. O perfil de cada um define as permissões e a função. Pessoas ocupam um assento fixo; o salário de um agente de IA começa o mês em zero e cresce com o custo dos tokens das suas tarefas."
        search={{ value: search, onChange: setSearch, placeholder: 'Buscar funcionário' }}
        count={`${agents.length} agente${agents.length === 1 ? '' : 's'}`}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<UserRound size={16} />}
              onClick={() => setEditing({ agent: null, kind: 'human' })}
            >
              Adicionar pessoa
            </Button>
            <Button
              variant="contained"
              startIcon={<Bot size={16} />}
              onClick={() => setEditing({ agent: null, kind: 'ai' })}
            >
              Adicionar agente de IA
            </Button>
          </Stack>
        }
      />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={0.5} role="group" aria-label="Filtrar">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="small"
              variant={filter === f.value ? 'contained' : 'outlined'}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </Stack>
        {sheet && (
          <Typography component="p" variant="body2" color="text.secondary" aria-label="Folha do mês">
            Folha de {sheet.month.split('-').reverse().join('/')}:{' '}
            <Box component="strong" sx={{ color: 'var(--color-n-slate-12)' }}>
              {brl(total())}
            </Box>{' '}
            · pessoas {brl(total('human'))} · IA {brl(total('ai'))} até agora
          </Typography>
        )}
      </Stack>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: { xl: 'flex-start' } }}>
        <Box
          sx={{
            display: 'grid',
            flex: 1,
            gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))',
            gap: 1.5,
            alignContent: 'start',
          }}
        >
          {shown.length === 0 && (
            <Typography component="p" sx={{ py: 10, textAlign: 'center', gridColumn: '1 / -1' }}>
              Nenhum agente.
            </Typography>
          )}
          {shown.map((agent) => (
            <MemberCard
              key={agent.id}
              agent={agent}
              skills={skills || []}
              salary={salaryOf(agent.id)}
              you={agent.user_id === user.id}
              selected={agent.id === selected}
              onOpen={() => setSelected(agent.id)}
              onEdit={() => setEditing({ agent, kind: agent.kind })}
              onDelete={agent.user_id === user.id || agent.system ? undefined : () => setRemoving(agent)}
            />
          ))}
        </Box>
        {detail && (
          <Box
            sx={{
              position: { xl: 'sticky' },
              top: 0,
              width: { xl: '24rem' },
              flexShrink: 0,
              alignSelf: 'flex-start',
            }}
          >
            <MemberDetail
              agent={detail}
              roster={agents}
              skills={skills || []}
              salary={salaryOf(detail.id)}
              rates={sheet?.rates}
              inboxes={catalog.inboxes}
              onEdit={() => setEditing({ agent: detail, kind: detail.kind })}
              onClose={() => setSelected(null)}
              onChanged={() => void changed()}
            />
          </Box>
        )}
      </Box>
      {editing && (
        <AgentRosterModal
          agent={editing.agent}
          kind={editing.kind}
          skills={skills || []}
          profiles={profiles}
          onManageAccess={(id) => {
            setEditing(null);
            setAccess(catalog.agents.find((u) => u.id === id) ?? null);
          }}
          onClose={() => setEditing(null)}
          onSaved={() => void changed()}
          onSkillsChanged={reloadSkills}
        />
      )}
      {access && (
        <AgentModal
          agent={access}
          catalog={catalog}
          roles={profiles}
          onClose={() => setAccess(null)}
          onSaved={changed}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Excluir o agente “${removing.name}”?`}
          description={
            removing.user_id
              ? 'O acesso ao helpdesk desta pessoa também é removido, junto com as suas skills.'
              : 'As skills ligadas a ele e as suas credenciais são removidas.'
          }
          confirm="Excluir"
          onConfirm={async () => {
            await http(`/agent_directory/${removing.id}`, 'DELETE');
            if (selected === removing.id) setSelected(null);
            await changed();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
