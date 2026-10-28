import { useState } from 'react';
import { http } from '../../api';
import type { RosterAgent } from '../../adminTypes';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import type { EngineActivity } from './types';

interface Props {
  agents: RosterAgent[];
  onClose: () => void;
  onStarted: (id: number) => void;
}

/** A request to an AI agent through the internal channel (the answer stays on the activity). */
export function AskModal({ agents, onClose, onStarted }: Props) {
  const [agent, setAgent] = useState(agents[0]?.id ?? 0),
    [request, setRequest] = useState('');
  const action = useAction();

  return (
    <Modal
      title="Novo pedido"
      description="O agente recebe o pedido, delega para quem tem a competência e responde citando as evidências."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const started = await http<EngineActivity>('/engine/activities', 'POST', {
              agent_id: agent,
              request: request.trim(),
            });
            onStarted(started.id);
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Agente</span>
          <select className="field" value={agent} onChange={(e) => setAgent(Number(e.target.value))}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Pedido</span>
          <textarea
            className="field"
            rows={3}
            required
            maxLength={4000}
            placeholder="Lu, o cliente ACME pagou?"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </label>
        <ModalFooter busy={action.busy} submit="Enviar" onCancel={onClose} error={action.error} />
      </form>
    </Modal>
  );
}
