import { Plus, X } from 'lucide-react';
import { http } from '../api';
import type { Catalog, Conversation, User } from '../types';
import { PRIORITY_LABEL } from '../labels';
import { Button } from '../ui/Button';
import { Dropdown, MenuItem } from '../ui/Overlay';

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
}

/** Chatwoot ConversationAction.vue: assigned agent (+ assign to me), team, priority, labels. */
export function ConversationActions({ conversation: c, user, catalog, onChange, onError }: Props) {
  const path = `/conversations/${c.display_id}`;
  const run = (request: Promise<Conversation>) =>
    request.then(onChange).catch((e: Error) => onError(e.message));
  const agents = catalog.agents.filter(
    (a) => a.active && (a.role === 'administrator' || a.inbox_ids?.includes(c.inbox_id)),
  );
  const available = catalog.labels.filter((l) => !c.labels.includes(l.title));
  const setLabels = (labels: string[]) => run(http(`${path}/labels`, 'POST', { labels }));
  const color = (title: string) => catalog.labels.find((l) => l.title === title)?.color || '#8B8D98';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm text-n-slate-12">
          <span id="assignee-label">Agente atribuído</span>
          {c.assignee_id !== user.id && (
            <button
              type="button"
              className="text-xs font-medium text-n-blue-11 hover:underline"
              onClick={() => void run(http(`${path}/assignments`, 'POST', { assignee_id: user.id }))}
            >
              Atribuir a mim
            </button>
          )}
        </div>
        <select
          className="field"
          aria-labelledby="assignee-label"
          value={c.assignee_id ?? ''}
          onChange={(e) =>
            void run(
              http(`${path}/assignments`, 'POST', {
                assignee_id: e.target.value ? Number(e.target.value) : null,
              }),
            )
          }
        >
          <option value="">Nenhum</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.availability === 'online' ? '' : a.availability === 'busy' ? ' · ocupado' : ' · offline'}
            </option>
          ))}
        </select>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-n-slate-12">Time atribuído</span>
        <select
          className="field"
          aria-label="Time atribuído"
          value={c.team_id ?? ''}
          onChange={(e) =>
            void run(
              http(`${path}/assignments`, 'POST', {
                team_id: e.target.value ? Number(e.target.value) : null,
              }),
            )
          }
        >
          <option value="">Nenhum</option>
          {catalog.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-n-slate-12">Prioridade</span>
        <select
          className="field"
          aria-label="Prioridade"
          value={c.priority ?? ''}
          onChange={(e) =>
            void run(http(`${path}/toggle_priority`, 'POST', { priority: e.target.value || null }))
          }
        >
          <option value="">Nenhuma</option>
          {Object.entries(PRIORITY_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="mb-2 block text-sm text-n-slate-12">Etiquetas da conversa</span>
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            align="start"
            className="max-h-60 w-56 overflow-y-auto"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-n-blue-11 outline outline-1 -outline-offset-1 outline-dashed outline-n-blue-9/40 hover:bg-n-blue-3"
              >
                <Plus size={12} /> Adicionar etiquetas
              </button>
            )}
          >
            {(close) =>
              available.length === 0 ? (
                <p className="p-2 text-sm text-n-slate-11">Nenhuma etiqueta disponível.</p>
              ) : (
                available.map((l) => (
                  <MenuItem
                    key={l.id}
                    label={
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-sm" style={{ background: l.color }} />
                        {l.title}
                      </span>
                    }
                    onClick={() => {
                      void setLabels([...c.labels, l.title]);
                      close();
                    }}
                  />
                ))
              )
            }
          </Dropdown>
          {c.labels.map((title) => (
            <span
              key={title}
              className="flex h-6 items-center gap-1.5 rounded-lg bg-n-label-color pr-1 pl-2 text-xs text-n-slate-12 outline outline-1 -outline-offset-1 outline-n-label-border"
            >
              <span className="size-2 rounded-sm" style={{ background: color(title) }} />
              {title}
              <Button
                color="slate"
                variant="ghost"
                size="xs"
                icon={X}
                aria-label={`Remover ${title}`}
                className="!size-4"
                onClick={() => void setLabels(c.labels.filter((l) => l !== title))}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
