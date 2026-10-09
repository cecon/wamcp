import { useState, type ReactNode } from 'react';
import { CircleDot, Flag, Tag, UserRound, Users, Workflow, X } from 'lucide-react';
import { http } from '../api';
import type { BulkResult, Catalog, ConversationStatus } from '../types';
import { PRIORITY_LABEL } from '../labels';
import { executeMacro, useMacros } from '../macros/useMacros';
import type { Macro } from '../accountTypes';
import { Button } from '../ui/Button';
import { Dropdown, MenuItem } from '../ui/Overlay';

type Fields = Partial<{
  status: ConversationStatus;
  snoozed_until: number;
  assignee_id: number | null;
  team_id: number | null;
  priority: string | null;
}>;
interface Change {
  fields?: Fields;
  labels?: { add?: string[]; remove?: string[] };
}
interface Option<T = Change> {
  label: string;
  change: T;
}

const STATUS_OPTIONS: Option[] = [
  { label: 'Abrir', change: { fields: { status: 'open' } } },
  { label: 'Resolver', change: { fields: { status: 'resolved' } } },
  { label: 'Marcar como pendente', change: { fields: { status: 'pending' } } },
];

function Menu<T>({
  icon,
  label,
  options,
  onPick,
}: {
  icon: typeof Tag;
  label: string;
  options: Option<NoInfer<T>>[];
  onPick: (change: T) => void;
}) {
  return (
    <Dropdown
      align="start"
      className="max-h-64 w-56 overflow-y-auto"
      trigger={({ toggle }) => (
        <Button color="slate" variant="faded" size="xs" icon={icon} aria-label={label} onClick={toggle} />
      )}
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.label}
            label={o.label}
            onClick={() => {
              close();
              onPick(o.change);
            }}
          />
        ))
      }
    </Dropdown>
  );
}

interface Props {
  selected: number[];
  total: number;
  catalog: Catalog;
  onSelectAll: (all: boolean) => void;
  onClear: () => void;
  onDone: (updated: number[]) => void;
}

/** Chatwoot BulkActionBar: select all, then status, agent, team, priority and labels for the selection. */
export function BulkActionBar({ selected, total, catalog, onSelectAll, onClear, onDone }: Props) {
  const [result, setResult] = useState<ReactNode>(null);
  const { macros } = useMacros();
  function apply(change: Change) {
    // "Adiar até amanhã" is timed when applied, not when the bar renders.
    const fields =
      change.fields?.status === 'snoozed'
        ? { ...change.fields, snoozed_until: Math.floor(Date.now() / 1000) + 86400 }
        : change.fields;
    return report(http<BulkResult>('/bulk_actions', 'POST', { ids: selected, ...change, fields }));
  }
  /** Bulk actions and macros answer `{updated, failed}`; failures are listed per conversation. */
  async function report(request: Promise<BulkResult>) {
    try {
      const r = await request;
      setResult(
        r.failed.length ? (
          <ul role="alert" className="text-xs text-n-ruby-11">
            {r.failed.map((f) => (
              <li key={f.id}>
                #{f.id}: {f.error}
              </li>
            ))}
          </ul>
        ) : null,
      );
      onDone(r.updated);
    } catch (e) {
      setResult(
        <p role="alert" className="text-xs text-n-ruby-11">
          {(e as Error).message}
        </p>,
      );
    }
  }
  const none = (key: 'assignee_id' | 'team_id', label: string): Option => ({
    label,
    change: { fields: { [key]: null } },
  });
  return (
    <div
      role="toolbar"
      aria-label="Ações em massa"
      className="flex flex-col gap-1 border-b border-n-weak bg-n-slate-2 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Selecionar todas"
          checked={selected.length === total}
          onChange={(e) => onSelectAll(e.target.checked)}
        />
        <span className="flex-1 text-xs font-medium text-n-slate-12">{selected.length} selecionada(s)</span>
        <Menu
          icon={CircleDot}
          label="Alterar status"
          options={[
            ...STATUS_OPTIONS,
            { label: 'Adiar até amanhã', change: { fields: { status: 'snoozed' } } },
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        <Menu
          icon={UserRound}
          label="Atribuir agente"
          options={[
            none('assignee_id', 'Remover agente'),
            ...catalog.agents.map((a) => ({ label: a.name, change: { fields: { assignee_id: a.id } } })),
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        <Menu
          icon={Users}
          label="Atribuir time"
          options={[
            none('team_id', 'Remover time'),
            ...catalog.teams.map((t) => ({ label: t.name, change: { fields: { team_id: t.id } } })),
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        <Menu
          icon={Flag}
          label="Alterar prioridade"
          options={[
            { label: 'Nenhuma', change: { fields: { priority: null } } },
            ...Object.entries(PRIORITY_LABEL).map(([id, label]) => ({
              label,
              change: { fields: { priority: id } },
            })),
          ]}
          onPick={(c: Change) => void apply(c)}
        />
        {macros.length > 0 && (
          <Menu
            icon={Workflow}
            label="Executar macro"
            options={macros.map((m) => ({ label: m.name, change: m }))}
            onPick={(m: Macro) => void report(executeMacro(m, selected))}
          />
        )}
        <Menu
          icon={Tag}
          label="Etiquetas"
          options={catalog.labels.flatMap((l) => [
            { label: `Adicionar ${l.title}`, change: { labels: { add: [l.title] } } },
            { label: `Remover ${l.title}`, change: { labels: { remove: [l.title] } } },
          ])}
          onPick={(c: Change) => void apply(c)}
        />
        <Button
          color="slate"
          variant="ghost"
          size="xs"
          icon={X}
          aria-label="Limpar seleção"
          onClick={onClear}
        />
      </div>
      {result}
    </div>
  );
}
