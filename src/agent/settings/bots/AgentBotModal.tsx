import { useState } from 'react';
import { http } from '../../api';
import type { AgentBot, CreatedAgentBot } from '../../adminTypes';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';
import { TokenNotice } from './TokenNotice';
import { LLM_PROVIDERS } from './llmProviders';

interface Props {
  bot: AgentBot | null;
  onClose: () => void;
  onSaved: () => void;
}

const DESCRIPTIONS = {
  webhook:
    'O robô recebe os eventos das caixas conectadas na URL de saída e responde pela API com o token de acesso.',
  llm: 'O próprio app responde as conversas pendentes com a LLM escolhida, seguindo as instruções abaixo, e transfere para a equipe quando precisar de uma pessoa.',
};

/** Bot form: a webhook bot (URL; creation shows the token once) or an LLM bot answered by the app. */
export function AgentBotModal({ bot, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    kind: bot?.kind || 'webhook',
    name: bot?.name || '',
    description: bot?.description || '',
    outgoing_url: bot?.outgoing_url || '',
    provider: bot?.provider || LLM_PROVIDERS[0].value,
    model: bot?.model || '',
    instructions: bot?.instructions || '',
  });
  const [token, setToken] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const llm = form.kind === 'llm';

  const body = () => {
    const common = { name: form.name.trim(), description: form.description.trim() || null };
    if (!llm) return { ...common, outgoing_url: form.outgoing_url };
    return {
      ...common,
      provider: form.provider,
      model: form.model.trim() || null,
      instructions: form.instructions.trim() || null,
    };
  };

  return (
    <Modal
      title={bot ? 'Editar robô' : 'Adicionar robô'}
      description={DESCRIPTIONS[form.kind]}
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
              if (bot) {
                await http(`/agent_bots/${bot.id}`, 'PATCH', body());
                onSaved();
                onClose();
                return;
              }
              const created = await http<CreatedAgentBot>('/agent_bots', 'POST', {
                ...body(),
                kind: form.kind,
              });
              onSaved();
              if (created.access_token) setToken(created.access_token);
              else onClose();
            });
          }}
        >
          {!bot && (
            <label>
              <span className="field-label">Tipo</span>
              <select className="field" {...field('kind')}>
                <option value="webhook">Webhook (sistema externo)</option>
                <option value="llm">LLM (o próprio app responde)</option>
              </select>
            </label>
          )}
          <label>
            <span className="field-label">Nome do robô</span>
            <input className="field" required maxLength={80} {...field('name')} />
          </label>
          <label>
            <span className="field-label">Descrição</span>
            <textarea className="field" rows={2} maxLength={500} {...field('description')} />
          </label>
          {llm ? (
            <>
              <label>
                <span className="field-label">Provedor</span>
                <select className="field" {...field('provider')}>
                  {LLM_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Modelo (opcional)</span>
                <input
                  className="field"
                  maxLength={80}
                  placeholder="Padrão do provedor (ex.: sonnet, haiku)"
                  {...field('model')}
                />
              </label>
              <label>
                <span className="field-label">Instruções para a IA</span>
                <textarea
                  className="field"
                  rows={6}
                  maxLength={4000}
                  placeholder="Ex.: Somos a Padaria Sol. Abrimos todos os dias das 7h às 19h. Encomendas e entregas: transfira para a equipe."
                  {...field('instructions')}
                />
              </label>
            </>
          ) : (
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
          )}
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
