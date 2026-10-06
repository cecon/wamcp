import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatTime, http } from '../api';
import type { Delivery, Webhook } from '../types';
import type { SettingsProps } from './SettingsPage';
import { useAction } from './useAction';
import { WEBHOOK_EVENTS } from '../labels';

const STATUS = { pending: 'pendente', sent: 'entregue', failed: 'falhou' };

export function WebhooksSettings({ catalog }: SettingsProps) {
  const [items, setItems] = useState<Webhook[]>([]),
    [form, setForm] = useState({ url: '', inbox_id: '', subscriptions: ['message_created'] }),
    [open, setOpen] = useState<number | null>(null),
    [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<Webhook[]>('/webhooks').then(setItems), []);
  useEffect(() => {
    void load();
  }, [load]);
  const toggleEvent = (event: string) =>
    setForm((f) => ({
      ...f,
      subscriptions: f.subscriptions.includes(event)
        ? f.subscriptions.filter((e) => e !== event)
        : [...f.subscriptions, event],
    }));
  async function showDeliveries(id: number) {
    setOpen(id);
    setDeliveries(await http<Delivery[]>(`/webhooks/${id}/deliveries`));
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Webhooks</h2>
        <p className="muted">
          Cada evento é enviado por POST com a assinatura <code>X-Wamcp-Signature</code> (HMAC-SHA256 de
          “timestamp.corpo”). Falhas são reenviadas por até 5 tentativas.
        </p>
        <ul className="plain-list">
          {items.map((w) => (
            <li key={w.id} className="row">
              <span>
                <strong>{w.url}</strong>
                <small>
                  {w.subscriptions.map((s) => WEBHOOK_EVENTS[s] || s).join(', ')} · segredo{' '}
                  <code>{w.secret}</code>
                </small>
              </span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={Boolean(w.active)}
                  aria-label={`Ativo ${w.url}`}
                  onChange={(e) =>
                    void run(async () => {
                      await http(`/webhooks/${w.id}`, 'PATCH', { active: e.target.checked });
                      await load();
                    })
                  }
                />
                ativo
              </label>
              <button className="btn ghost small" onClick={() => void run(() => showDeliveries(w.id))}>
                Entregas
              </button>
              <button
                className="icon-btn"
                aria-label={`Excluir ${w.url}`}
                onClick={() =>
                  void run(async () => {
                    await http(`/webhooks/${w.id}`, 'DELETE');
                    await load();
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 && <p className="muted">Nenhum webhook cadastrado.</p>}
        {open && (
          <div className="deliveries" aria-label="Entregas recentes">
            <h3>Entregas recentes</h3>
            {deliveries.length === 0 && <p className="muted">Nenhuma entrega ainda.</p>}
            {deliveries.map((d) => (
              <p key={d.id} className={`delivery ${d.status}`}>
                {formatTime(d.created_at)} · {d.event} · {STATUS[d.status]} ({d.attempts}x)
                {d.last_error ? ` · ${d.last_error}` : ''}
              </p>
            ))}
          </div>
        )}
      </section>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/webhooks', 'POST', {
              url: form.url,
              subscriptions: form.subscriptions,
              inbox_id: form.inbox_id ? Number(form.inbox_id) : null,
            });
            setForm({ url: '', inbox_id: '', subscriptions: ['message_created'] });
            await load();
          });
        }}
      >
        <h2>Novo webhook</h2>
        <label>
          URL
          <input
            type="url"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://"
            required
          />
        </label>
        <label>
          Caixa de entrada
          <select value={form.inbox_id} onChange={(e) => setForm({ ...form, inbox_id: e.target.value })}>
            <option value="">Todas</option>
            {catalog.inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Eventos</legend>
          {Object.entries(WEBHOOK_EVENTS).map(([event, label]) => (
            <label key={event} className="check">
              <input
                type="checkbox"
                checked={form.subscriptions.includes(event)}
                onChange={() => toggleEvent(event)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" disabled={busy || !form.subscriptions.length}>
          Criar webhook
        </button>
      </form>
    </div>
  );
}
