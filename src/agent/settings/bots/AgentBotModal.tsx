import { useState } from 'react';
import { http } from '../../api';
import type { AgentBot, CreatedAgentBot } from '../../adminTypes';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { TokenNotice } from './TokenNotice';

interface Props {
  bot: AgentBot | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Chatwoot agent bot form: name, description and the outgoing URL; creation shows the token once. */
export function AgentBotModal({ bot, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: bot?.name || '',
    description: bot?.description || '',
    outgoing_url: bot?.outgoing_url || '',
  });
  const [token, setToken] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <Modal
      title={bot ? 'Editar robô' : 'Adicionar robô'}
      description="O robô recebe os eventos das caixas conectadas na URL de saída e responde pela API com o token de acesso."
      onClose={onClose}
    >
      {token ? (
        <TokenNotice token={token} onDone={onClose} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const body = { ...form, name: form.name.trim(), description: form.description.trim() || null };
              if (bot) {
                await http(`/agent_bots/${bot.id}`, 'PATCH', body);
                onSaved();
                onClose();
              } else {
                const created = await http<CreatedAgentBot>('/agent_bots', 'POST', body);
                setToken(created.access_token);
                onSaved();
              }
            });
          }}
        >
          <label>
            <span className="field-label">Nome do robô</span>
            <input className="field" required maxLength={80} {...field('name')} />
          </label>
          <label>
            <span className="field-label">Descrição</span>
            <textarea className="field" rows={3} maxLength={500} {...field('description')} />
          </label>
          <label>
            <span className="field-label">URL de saída</span>
            <input
              className="field"
              type="url"
              required
              placeholder="Exemplo: https://exemplo.com/robo"
              {...field('outgoing_url')}
            />
          </label>
          <ModalFooter
            busy={busy}
            submit={bot ? 'Atualizar robô' : 'Criar robô'}
            onCancel={onClose}
            error={error}
          />
        </form>
      )}
    </Modal>
  );
}
