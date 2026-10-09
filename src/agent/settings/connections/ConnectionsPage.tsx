import { useState } from 'react';
import { MessageCircle, Plus, Settings } from 'lucide-react';
import { http } from '../../api';
import type { Route } from '../../route';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { ModalFooter, SettingsHeader, SettingsPage } from '../../ui/Settings';
import { useAction } from '../useAction';
import { ConnectionDetailPage } from './ConnectionDetailPage';
import { ConnectionStatus } from './ConnectionStatus';
import { formatPhone, type Connection } from './model';

interface Props {
  connectionId?: string;
  onNavigate: (route: Route) => void;
  /** Reloads the catalog: a new connection also creates its inbox. */
  onChange: () => Promise<void>;
}

const open = (connectionId?: string): Route => ({ page: 'settings', section: 'connections', connectionId });

/** Configurações → Conexões WhatsApp (Chatwoot channel settings): one paired phone per connection. */
export function ConnectionsPage({ connectionId, onNavigate, onChange }: Props) {
  const { data, error, reload } = useFetch<Connection[]>(connectionId ? null : '/sessions');
  const [creating, setCreating] = useState(false);
  if (connectionId)
    return (
      <ConnectionDetailPage
        key={connectionId}
        id={connectionId}
        onBack={() => onNavigate(open())}
        onChange={onChange}
      />
    );
  const list = data || [];
  return (
    <SettingsPage>
      <SettingsHeader
        title="Conexões WhatsApp"
        description="Cada conexão é um WhatsApp vinculado por QR Code e vira uma caixa de entrada do atendimento. Também oferece acesso MCP para ferramentas de IA."
        count={data ? `${list.length} ${list.length === 1 ? 'conexão' : 'conexões'}` : undefined}
        action={<Button icon={Plus} label="Nova conexão" onClick={() => setCreating(true)} />}
      />
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <ul className="divide-y divide-n-weak border-t border-n-weak">
        {data && list.length === 0 && (
          <li className="py-20 text-center text-base">
            Nenhuma conexão ainda. Crie uma e leia o QR Code com o celular.
          </li>
        )}
        {list.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-n-strong bg-n-alpha-3 text-n-teal-10 shadow-sm">
                <MessageCircle size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-heading-3 truncate text-n-slate-12">{c.name}</p>
                <p className="truncate text-sm text-n-slate-11">{formatPhone(c.phone)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ConnectionStatus status={c.status} />
              <Button
                color="slate"
                variant="faded"
                icon={Settings}
                aria-label={`Abrir ${c.name}`}
                onClick={() => onNavigate(open(c.id))}
              />
            </div>
          </li>
        ))}
      </ul>
      {creating && (
        <NewConnectionModal
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            reload();
            void onChange().catch(() => {});
            onNavigate(open(created.id));
          }}
        />
      )}
    </SettingsPage>
  );
}

function NewConnectionModal({
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
