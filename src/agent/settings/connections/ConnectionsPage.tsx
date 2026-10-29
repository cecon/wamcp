import { useState } from 'react';
import { http } from '../../api';
import type { Route } from '../../route';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { ConnectionDetailPage } from './ConnectionDetailPage';
import type { Connection } from './model';

interface Props {
  connectionId: string;
  onNavigate: (route: Route) => void;
  /** Reloads the catalog: a new connection also creates its inbox. */
  onChange: () => Promise<void>;
}

/** Configurações → Canais → a WhatsApp connection: QR Code pairing, status and MCP access. */
export function ConnectionsPage({ connectionId, onNavigate, onChange }: Props) {
  return (
    <ConnectionDetailPage
      key={connectionId}
      id={connectionId}
      onBack={() => onNavigate({ page: 'settings', section: 'inboxes' })}
      onChange={onChange}
    />
  );
}

/** A new WhatsApp connection (its inbox is created with the same name). */
export function NewConnectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (connection: Connection) => void;
}) {
  const [name, setName] = useState('');
  const { error, busy, run } = useAction();
  return (
    <Modal
      title="Nova conexão"
      description="Dê um nome para identificar este WhatsApp. Uma caixa de entrada com o mesmo nome é criada."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onCreated(await http<Connection>('/sessions', 'POST', { name: name.trim() })));
        }}
      >
        <label>
          <span className="field-label">Nome da conexão</span>
          <input
            className="field"
            autoFocus
            required
            maxLength={80}
            value={name}
            placeholder="Ex.: Atendimento"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <ModalFooter busy={busy || !name.trim()} submit="Criar conexão" onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
