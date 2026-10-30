import { useState } from 'react';
import { History, Play, Plus } from 'lucide-react';
import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Confirm';
import { SidePanel } from '../../ui/Overlay';
import { Cell, RowActions, SettingsHeader, SettingsPage, Table } from '../../ui/Settings';
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

  return (
    <SettingsPage>
      <SettingsHeader
        title="Agendamentos"
        description="Tarefas recorrentes em que agentes de IA se inscrevem para trabalhar sozinhos (como o /loop do Claude Code). A cada execução, o resultado chega no chat de quem criou o agendamento com o agente."
        count={`${schedules.length} agendamento${schedules.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Novo agendamento" onClick={() => setEditing('new')} />}
      />
      {(loadError || (error && !editing)) && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {loadError || error}
        </p>
      )}
      {notice && <p className="text-sm text-n-teal-11">{notice}</p>}
      <Table
        headers={['Nome', 'Quando', 'Agentes', 'Próxima execução', '']}
        rows={schedules.length}
        empty="Nenhum agendamento ainda."
      >
        {schedules.map((s) => (
          <tr key={s.id}>
            <Cell>
              <span className="block font-medium text-n-slate-12">{s.name}</span>
              <span className="line-clamp-1 text-sm">{s.prompt}</span>
            </Cell>
            <Cell>{describeWhen(s)}</Cell>
            <Cell>{s.agent_ids.length ? s.agent_ids.map(nameOf).join(', ') : '—'}</Cell>
            <Cell>{s.active ? formatTime(s.next_run_at, s.timezone) : 'Pausado'}</Cell>
            <Cell className="w-48">
              <div className="flex justify-end gap-1">
                <Button
                  color="slate"
                  variant="faded"
                  size="sm"
                  icon={Play}
                  aria-label={`Executar agora ${s.name}`}
                  disabled={busy || s.agent_ids.length === 0}
                  onClick={() => runNow(s)}
                />
                <Button
                  color="slate"
                  variant="faded"
                  size="sm"
                  icon={History}
                  aria-label={`Histórico de ${s.name}`}
                  onClick={() => setHistory(s)}
                />
                <RowActions labelFor={s.name} onEdit={() => setEditing(s)} onDelete={() => setDeleting(s)} />
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
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
        <ConfirmModal
          title="Excluir agendamento"
          description={`Você tem certeza que deseja excluir “${deleting.name}”? O histórico de execuções também será apagado.`}
          confirm="Sim, excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await http(`/agent_schedules/${deleting.id}`, 'DELETE');
            reload();
          }}
        />
      )}
    </SettingsPage>
  );
}
