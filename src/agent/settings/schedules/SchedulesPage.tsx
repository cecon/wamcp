import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { History, Pencil, Play, Plus, Trash2 } from 'lucide-react';

// C3Theme
import { ActionDialog, Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { SidePanel } from '../../ui/Overlay';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
import { useAction } from '../useAction';
import { RunHistory } from './RunHistory';
import { ScheduleEditor } from './ScheduleEditor';
import { describeWhen, formatTime, type AgentSchedule, type ScheduleDraft } from './types';

/**
 * Schedules ("crons") AI agents subscribe to so they work by themselves, like Claude Code's /loop:
 * each run's output arrives in the creator's chat with the agent. The system agent is never listed.
 */
export function SchedulesPage() {
  const { data, error: loadError, reload } = useFetch<AgentSchedule[]>('/agent_schedules');
  const roster = useFetch<RosterAgent[]>('/agent_directory');
  const [editing, setEditing] = useState<AgentSchedule | 'new' | null>(null),
    [history, setHistory] = useState<AgentSchedule | null>(null),
    [deleting, setDeleting] = useState<AgentSchedule | null>(null),
    [ran, setRan] = useState(0),
    [notice, setNotice] = useState('');
  const { error, busy, run } = useAction();
  const schedules = data ?? [];
  const agents = (roster.data ?? []).filter((a) => a.kind === 'ai' && !a.system && a.runtime);
  const nameOf = (id: number) => roster.data?.find((a) => a.id === id)?.name ?? `#${id}`;

  const save = (draft: ScheduleDraft) =>
    void run(async () => {
      if (editing === 'new') await http('/agent_schedules', 'POST', draft);
      else if (editing) await http(`/agent_schedules/${editing.id}`, 'PATCH', draft);
      setEditing(null);
      reload();
    });
  const runNow = (s: AgentSchedule) =>
    void run(async () => {
      setNotice('');
      await http(`/agent_schedules/${s.id}/runs`, 'POST', {});
      setNotice(`“${s.name}” começou agora; o resultado chega no chat com cada agente.`);
      setRan((n) => n + 1);
      setHistory(s);
    });

  const actions = (s: AgentSchedule) => (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
      <IconButton
        size="small"
        aria-label={`Executar agora ${s.name}`}
        disabled={busy || s.agent_ids.length === 0}
        onClick={() => runNow(s)}
      >
        <Play size={14} />
      </IconButton>
      <IconButton size="small" aria-label={`Histórico de ${s.name}`} onClick={() => setHistory(s)}>
        <History size={14} />
      </IconButton>
      <IconButton size="small" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}>
        <Pencil size={14} />
      </IconButton>
      <IconButton size="small" color="error" aria-label={`Excluir ${s.name}`} onClick={() => setDeleting(s)}>
        <Trash2 size={14} />
      </IconButton>
    </Stack>
  );

  const columns: ColumnDef<AgentSchedule>[] = [
    {
      id: 'name',
      header: 'Nome',
      accessorKey: 'name',
      cell: (info) => (
        <Stack>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {info.row.original.name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {info.row.original.prompt}
          </Typography>
        </Stack>
      ),
    },
    {
      id: 'when',
      header: 'Quando',
      accessorFn: (schedule) => describeWhen(schedule),
      cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
    },
    {
      id: 'agents',
      header: 'Agentes',
      accessorFn: (schedule) => schedule.agent_ids.map(nameOf).join(', ') || '—',
      cell: (info) => (
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'next',
      header: 'Próxima execução',
      accessorFn: (schedule) =>
        schedule.active ? formatTime(schedule.next_run_at, schedule.timezone) : 'Pausado',
      cell: (info) => (
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          {String(info.getValue())}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => actions(info.row.original),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Agendamentos"
        description="Tarefas recorrentes em que agentes de IA se inscrevem para trabalhar sozinhos (como o /loop do Claude Code). A cada execução, o resultado chega no chat de quem criou o agendamento com o agente."
        count={`${schedules.length} agendamento${schedules.length === 1 ? '' : 's'}`}
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Novo agendamento
          </Button>
        }
      />
      {(loadError || (error && !editing)) && <SettingsC3Error>{loadError || error}</SettingsC3Error>}
      {notice && (
        <Typography variant="body2" sx={{ color: 'success.main' }}>
          {notice}
        </Typography>
      )}
      <Panel flush>
        <DataTable
          rows={schedules}
          columns={columns}
          getRowId={(schedule) => String(schedule.id)}
          paginate={schedules.length > 10}
          empty="Nenhum agendamento ainda."
          ariaLabel="Agendamentos"
        />
      </Panel>
      {editing && (
        <SidePanel
          title={editing === 'new' ? 'Novo agendamento' : 'Editar agendamento'}
          onClose={() => setEditing(null)}
        >
          <ScheduleEditor
            schedule={editing === 'new' ? undefined : editing}
            agents={agents}
            busy={busy}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </SidePanel>
      )}
      {history && (
        <SidePanel title={`Execuções de ${history.name}`} onClose={() => setHistory(null)}>
          <RunHistory schedule={history} refresh={ran} />
        </SidePanel>
      )}
      {deleting && (
        <ActionDialog
          open
          title="Excluir agendamento"
          description={`Você tem certeza que deseja excluir “${deleting.name}”? O histórico de execuções também será apagado.`}
          confirmLabel="Sim, excluir"
          backLabel="Cancelar"
          tone="danger"
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            void run(async () => {
              await http(`/agent_schedules/${deleting.id}`, 'DELETE');
              setDeleting(null);
              reload();
            })
          }
        />
      )}
    </SettingsC3Page>
  );
}
