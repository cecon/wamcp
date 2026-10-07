import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { formatTime, http } from '../api';
import type { Catalog, Delivery, Webhook } from '../types';
import { WEBHOOK_EVENTS } from '../labels';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { Modal, SidePanel } from '../ui/Overlay';
import { Cell, ModalFooter, RowActions, SettingsHeader, SettingsPage, Table, Toggle } from '../ui/Settings';
import { useAction } from './useAction';

const STATUS: Record<Delivery['status'], [string, string]> = {
  pending: ['pendente', 'text-n-amber-11'],
  sent: ['entregue', 'text-n-teal-11'],
  failed: ['falhou', 'text-n-ruby-11'],
};

/** Chatwoot Webhooks: "Webhook endpoint | Actions" table and the add/edit modal with event checkboxes. */
export function WebhooksPage({ catalog }: { catalog: Catalog }) {
  const [items, setItems] = useState<Webhook[]>([]),
    [q, setQ] = useState(''),
    [editing, setEditing] = useState<Webhook | 'new' | null>(null),
    [deliveries, setDeliveries] = useState<{ hook: Webhook; list: Delivery[] } | null>(null);
  const { error, run } = useAction();
  const load = useCallback(() => http<Webhook[]>('/webhooks').then(setItems), []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const visible = items.filter((w) => w.url.toLowerCase().includes(q.toLowerCase()));

  return (
    <SettingsPage>
      <SettingsHeader
        title="Webhooks"
        description="Os eventos de webhook informam em tempo real o que acontece no atendimento. Cada POST leva a assinatura X-Wamcp-Signature (HMAC-SHA256 de “timestamp.corpo”) e falhas são reenviadas por até 5 tentativas."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar webhooks…' }}
        count={`${items.length} webhook${items.length === 1 ? '' : 's'}`}
        action={<Button icon={Plus} label="Adicionar novo webhook" onClick={() => setEditing('new')} />}
      />
      {error && <p className="text-sm text-n-ruby-11">{error}</p>}
      <Table
        headers={['Endpoint do webhook', 'Ativo', 'Ações']}
        rows={visible.length}
        empty="Nenhum webhook cadastrado."
      >
        {visible.map((w) => (
          <tr key={w.id}>
            <Cell>
              <span className="block font-medium break-all text-n-slate-12">{w.url}</span>
              <span className="text-sm">
                Eventos assinados: {w.subscriptions.map((s) => WEBHOOK_EVENTS[s] || s).join(', ')}
                {w.inbox_id
                  ? ` · ${catalog.inboxes.find((i) => i.id === w.inbox_id)?.name || 'caixa removida'}`
                  : ''}
              </span>
            </Cell>
            <Cell className="w-20">
              <Toggle
                compact
                label={`Ativo ${w.url}`}
                checked={Boolean(w.active)}
                onChange={(active) =>
                  void run(async () => {
                    await http(`/webhooks/${w.id}`, 'PATCH', { active });
                    await load();
                  })
                }
              />
            </Cell>
            <Cell className="w-40">
              <div className="flex justify-end gap-1">
                <Button
                  color="slate"
                  variant="faded"
                  label="Entregas"
                  onClick={() =>
                    void run(async () =>
                      setDeliveries({ hook: w, list: await http(`/webhooks/${w.id}/deliveries`) }),
                    )
                  }
                />
                <RowActions
                  labelFor={w.url}
                  onEdit={() => setEditing(w)}
                  onDelete={() =>
                    void run(async () => {
                      await http(`/webhooks/${w.id}`, 'DELETE');
                      await load();
                    })
                  }
                />
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
      {editing && (
        <WebhookModal
          webhook={editing === 'new' ? null : editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {deliveries && (
        <SidePanel title="Entregas recentes" onClose={() => setDeliveries(null)}>
          <p className="mb-4 text-sm break-all text-n-slate-11">{deliveries.hook.url}</p>
          {deliveries.list.length === 0 && <p className="text-sm text-n-slate-11">Nenhuma entrega ainda.</p>}
          <ul className="divide-y divide-n-weak">
            {deliveries.list.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-n-slate-12">{WEBHOOK_EVENTS[d.event] || d.event}</span>
                  <span className="text-n-slate-11"> · {formatTime(d.created_at)}</span>
                </span>
                <span className={cn('text-right', STATUS[d.status][1])}>
                  {STATUS[d.status][0]} ({d.attempts}x){d.last_error ? ` · ${d.last_error}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </SidePanel>
      )}
    </SettingsPage>
  );
}

interface ModalProps {
  webhook: Webhook | null;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}

function WebhookModal({ webhook, catalog, onClose, onSaved }: ModalProps) {
  const [form, setForm] = useState({
    url: webhook?.url || '',
    inbox_id: webhook?.inbox_id ? String(webhook.inbox_id) : '',
    subscriptions: webhook?.subscriptions || ['conversation_created', 'message_created'],
  });
  const [created, setCreated] = useState<Webhook | null>(null);
  const { error, busy, run } = useAction();
  const toggle = (event: string) =>
    setForm((f) => ({
      ...f,
      subscriptions: f.subscriptions.includes(event)
        ? f.subscriptions.filter((e) => e !== event)
        : [...f.subscriptions, event],
    }));
  const secret = created?.secret || webhook?.secret;

  return (
    <Modal
      title={webhook ? 'Editar webhook' : 'Adicionar novo webhook'}
      description="Informe uma URL válida para receber os eventos escolhidos."
      onClose={onClose}
    >
      {created ? (
        <SecretView secret={created.secret} onDone={onClose} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const body = {
                url: form.url,
                subscriptions: form.subscriptions,
                inbox_id: form.inbox_id ? Number(form.inbox_id) : null,
              };
              if (webhook) {
                await http(`/webhooks/${webhook.id}`, 'PATCH', body);
                await onSaved();
                onClose();
              } else {
                setCreated(await http<Webhook>('/webhooks', 'POST', body));
                await onSaved();
              }
            });
          }}
        >
          <label>
            <span className="field-label">URL do webhook</span>
            <input
              className="field"
              type="url"
              required
              value={form.url}
              placeholder="Exemplo: https://exemplo.com/api/webhook"
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </label>
          <label>
            <span className="field-label">Caixa de entrada</span>
            <select
              className="field"
              value={form.inbox_id}
              onChange={(e) => setForm({ ...form, inbox_id: e.target.value })}
            >
              <option value="">Todas</option>
              {catalog.inboxes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          {webhook && secret && <SecretField secret={secret} />}
          <fieldset>
            <legend className="field-label">Eventos</legend>
            <div className="flex flex-col gap-2.5">
              {Object.entries(WEBHOOK_EVENTS).map(([event, label]) => (
                <label key={event} className="flex items-center gap-2 text-sm text-n-slate-12">
                  <input
                    type="checkbox"
                    className="size-4 accent-n-brand"
                    checked={form.subscriptions.includes(event)}
                    onChange={() => toggle(event)}
                  />
                  {label} <span className="text-n-slate-10">({event})</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ModalFooter
            busy={busy || !form.subscriptions.length}
            submit={webhook ? 'Atualizar webhook' : 'Criar webhook'}
            onCancel={onClose}
            error={error}
          />
        </form>
      )}
    </Modal>
  );
}

function SecretField({ secret }: { secret: string }) {
  return (
    <label>
      <span className="field-label">Segredo de assinatura</span>
      <span className="flex gap-2">
        <input className="field font-mono" readOnly value={secret} aria-label="Segredo de assinatura" />
        <Button
          color="slate"
          variant="faded"
          size="md"
          icon={Copy}
          aria-label="Copiar segredo"
          onClick={() => void navigator.clipboard?.writeText(secret)}
        />
      </span>
    </label>
  );
}

function SecretView({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-n-slate-11">
        Webhook criado. Guarde o segredo abaixo para validar a assinatura dos eventos.
      </p>
      <SecretField secret={secret} />
      <div className="flex justify-end">
        <Button label="Concluir" onClick={onDone} />
      </div>
    </div>
  );
}
