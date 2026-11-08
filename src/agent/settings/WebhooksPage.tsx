import { useCallback, useEffect, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// third-party
import { Plus } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';
import { DataTable } from '@c3theme/ui/table';

import { http } from '../api';
import type { Catalog, Delivery, Webhook } from '../types';
import { WEBHOOK_EVENTS } from '../labels';
import { Modal } from '../ui/Overlay';
import { SecretField as Secret } from '../ui/SecretField';
import { ModalFooter, RowActions, Toggle } from '../ui/Settings';
import { DeliveriesPanel } from './DeliveriesPanel';
import { useAction } from './useAction';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

const SecretField = ({ secret }: { secret: string }) => (
  <Secret label="Segredo de assinatura" copyLabel="Copiar segredo" secret={secret} />
);

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

  const subscriptionsLabel = (w: Webhook) =>
    `Eventos assinados: ${w.subscriptions.map((s) => WEBHOOK_EVENTS[s] || s).join(', ')}${
      w.inbox_id ? ` · ${catalog.inboxes.find((i) => i.id === w.inbox_id)?.name || 'caixa removida'}` : ''
    }`;
  const columns: ColumnDef<Webhook>[] = [
    {
      id: 'url',
      header: 'Endpoint do webhook',
      accessorFn: (w) => w.url,
      cell: (info) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-all' }}>
            {info.row.original.url}
          </Typography>
          <Typography variant="caption" component="span" color="text.secondary" sx={{ display: 'block' }}>
            {subscriptionsLabel(info.row.original)}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'active',
      header: 'Ativo',
      accessorFn: (w) => (w.active ? 'Ativo' : 'Inativo'),
      cell: (info) => (
        <Toggle
          compact
          label={`Ativo ${info.row.original.url}`}
          checked={Boolean(info.row.original.active)}
          onChange={(active) =>
            void run(async () => {
              await http(`/webhooks/${info.row.original.id}`, 'PATCH', { active });
              await load();
            })
          }
        />
      ),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (info) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              void run(async () =>
                setDeliveries({
                  hook: info.row.original,
                  list: await http(`/webhooks/${info.row.original.id}/deliveries`),
                }),
              )
            }
          >
            Entregas
          </Button>
          <RowActions
            labelFor={info.row.original.url}
            onEdit={() => setEditing(info.row.original)}
            onDelete={() =>
              void run(async () => {
                await http(`/webhooks/${info.row.original.id}`, 'DELETE');
                await load();
              })
            }
          />
        </Stack>
      ),
    },
  ];

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Webhooks"
        description="Os eventos de webhook informam em tempo real o que acontece no atendimento. Cada POST leva a assinatura X-Wamcp-Signature (HMAC-SHA256 de “timestamp.corpo”) e falhas são reenviadas por até 5 tentativas."
        search={{ value: q, onChange: setQ, placeholder: 'Pesquisar webhooks…' }}
        count={`${items.length} webhook${items.length === 1 ? '' : 's'}`}
        action={
          <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => setEditing('new')}>
            Adicionar novo webhook
          </Button>
        }
      />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Panel flush>
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(w) => String(w.id)}
          empty="Nenhum webhook cadastrado."
          ariaLabel="Webhooks"
        />
      </Panel>
      {editing && (
        <WebhookModal
          webhook={editing === 'new' ? null : editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {deliveries && (
        <DeliveriesPanel
          target={deliveries.hook.url}
          list={deliveries.list}
          onClose={() => setDeliveries(null)}
        />
      )}
    </SettingsC3Page>
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

function SecretView({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-n-slate-11">
        Webhook criado. Guarde o segredo abaixo para validar a assinatura dos eventos.
      </p>
      <SecretField secret={secret} />
      <div className="flex justify-end">
        <Button variant="contained" onClick={onDone}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
