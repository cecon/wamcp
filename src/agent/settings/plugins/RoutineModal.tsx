import { useState } from 'react';
import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { useFetch } from '../../useFetch';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import type { Plugin, PluginSchedule } from './types';

interface Props {
  plugin: Plugin;
  routine: PluginSchedule;
  onClose: () => void;
  onCreated: (name: string) => void;
}

/** Creates the routine a plugin suggests as a schedule, for the AI agents the administrator picks. */
export function RoutineModal({ plugin, routine, onClose, onCreated }: Props) {
  const roster = useFetch<RosterAgent[]>('/agent_directory');
  const [chosen, setChosen] = useState<number[]>([]);
  const { error, busy, run } = useAction();
  const agents = (roster.data || []).filter((a) => a.kind === 'ai' && !a.system);
  const name = `${plugin.manifest.name}: ${routine.name}`;

  return (
    <Modal
      title={`Criar a rotina “${routine.name}”`}
      description={`${routine.description || routine.cron}. Escolha quais agentes de IA fazem esta rotina; você pode mudar depois em Agendamentos.`}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (chosen.length === 0) throw new Error('Escolha pelo menos um agente');
            await http('/agent_schedules', 'POST', {
              name,
              cron: routine.cron,
              prompt: routine.prompt,
              agent_ids: chosen,
            });
            onCreated(name);
            onClose();
          });
        }}
      >
        <p className="text-sm text-n-slate-11">{routine.prompt}</p>
        {agents.length === 0 && <p className="text-sm text-n-slate-11">Nenhum agente de IA cadastrado.</p>}
        {agents.map((agent) => (
          <label key={agent.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.includes(agent.id)}
              onChange={(e) =>
                setChosen(e.target.checked ? [...chosen, agent.id] : chosen.filter((id) => id !== agent.id))
              }
            />
            {agent.name}
          </label>
        ))}
        <ModalFooter busy={busy} submit="Criar rotina" onCancel={onClose} error={error || roster.error} />
      </form>
    </Modal>
  );
}
