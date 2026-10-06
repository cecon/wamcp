import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Action, Catalog, Condition } from '../types';
import { ACTIONS, AUTOMATION_EVENTS, CONDITION_ATTRIBUTES, OPERATORS, PRIORITY_LABEL } from '../labels';

export interface RuleDraft {
  name: string;
  event_name: string;
  conditions: Condition[];
  actions: Action[];
}
const NO_VALUE = new Set(['is_present', 'is_not_present']);
const NO_PARAM = new Set(['resolve_conversation', 'open_conversation']);
const newCondition = (): Condition => ({
  attribute_key: 'content',
  filter_operator: 'contains',
  values: [],
  query_operator: 'and',
});
const newAction = (): Action => ({ action_name: 'add_label', action_params: [] });

/** Option lists for selects that pick catalog entities instead of free text. */
function choices(key: string, catalog: Catalog): [string, string][] | null {
  if (key === 'assign_agent' || key === 'assignee_id')
    return catalog.agents.map((a) => [String(a.id), a.name]);
  if (key === 'assign_team' || key === 'team_id') return catalog.teams.map((t) => [String(t.id), t.name]);
  if (key === 'inbox_id') return catalog.inboxes.map((i) => [String(i.id), i.name]);
  if (key === 'add_label' || key === 'remove_label' || key === 'labels')
    return catalog.labels.map((l) => [l.title, l.title]);
  if (key === 'set_priority') return Object.entries(PRIORITY_LABEL);
  if (key === 'status')
    return [
      ['open', 'Aberta'],
      ['pending', 'Pendente'],
      ['resolved', 'Resolvida'],
      ['snoozed', 'Adiada'],
    ];
  if (key === 'message_type')
    return [
      ['incoming', 'Recebida'],
      ['outgoing', 'Enviada'],
    ];
  return null;
}

function ValueInput({
  id,
  value,
  options,
  onChange,
  multiline,
}: {
  id: string;
  value: string;
  options: [string, string][] | null;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  if (options)
    return (
      <select aria-label={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione…</option>
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    );
  return multiline ? (
    <textarea
      aria-label={id}
      value={value}
      rows={2}
      maxLength={4096}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input aria-label={id} value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} />
  );
}

interface Props {
  catalog: Catalog;
  busy: boolean;
  onSave: (rule: RuleDraft) => void;
}

export function RuleEditor({ catalog, busy, onSave }: Props) {
  const [rule, setRule] = useState<RuleDraft>({
    name: '',
    event_name: 'message_created',
    conditions: [newCondition()],
    actions: [newAction()],
  });
  const setCondition = (i: number, patch: Partial<Condition>) =>
    setRule((r) => ({ ...r, conditions: r.conditions.map((c, j) => (i === j ? { ...c, ...patch } : c)) }));
  const setAction = (i: number, patch: Partial<Action>) =>
    setRule((r) => ({ ...r, actions: r.actions.map((a, j) => (i === j ? { ...a, ...patch } : a)) }));
  return (
    <form
      className="panel rule-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rule);
      }}
    >
      <h2>Nova automação</h2>
      <label>
        Nome
        <input
          value={rule.name}
          onChange={(e) => setRule({ ...rule, name: e.target.value })}
          maxLength={120}
          required
        />
      </label>
      <label>
        Quando
        <select value={rule.event_name} onChange={(e) => setRule({ ...rule, event_name: e.target.value })}>
          {Object.entries(AUTOMATION_EVENTS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Condições</legend>
        {rule.conditions.map((c, i) => (
          <div key={i} className="rule-row">
            <select
              aria-label={`Atributo ${i + 1}`}
              value={c.attribute_key}
              onChange={(e) => setCondition(i, { attribute_key: e.target.value, values: [] })}
            >
              {Object.entries(CONDITION_ATTRIBUTES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label={`Operador ${i + 1}`}
              value={c.filter_operator}
              onChange={(e) => setCondition(i, { filter_operator: e.target.value })}
            >
              {Object.entries(OPERATORS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {!NO_VALUE.has(c.filter_operator) && (
              <ValueInput
                id={`Valor ${i + 1}`}
                value={String(c.values[0] ?? '')}
                options={choices(c.attribute_key, catalog)}
                onChange={(v) => setCondition(i, { values: v ? [v] : [] })}
              />
            )}
            {i < rule.conditions.length - 1 && (
              <select
                aria-label={`Junção ${i + 1}`}
                value={c.query_operator}
                onChange={(e) => setCondition(i, { query_operator: e.target.value as 'and' | 'or' })}
              >
                <option value="and">E</option>
                <option value="or">OU</option>
              </select>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remover condição ${i + 1}`}
              onClick={() => setRule({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost small"
          onClick={() => setRule({ ...rule, conditions: [...rule.conditions, newCondition()] })}
        >
          <Plus size={14} /> Condição
        </button>
      </fieldset>
      <fieldset>
        <legend>Ações</legend>
        {rule.actions.map((a, i) => (
          <div key={i} className="rule-row">
            <select
              aria-label={`Ação ${i + 1}`}
              value={a.action_name}
              onChange={(e) => setAction(i, { action_name: e.target.value, action_params: [] })}
            >
              {Object.entries(ACTIONS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {!NO_PARAM.has(a.action_name) && (
              <ValueInput
                id={`Parâmetro ${i + 1}`}
                value={String(a.action_params[0] ?? '')}
                options={choices(a.action_name, catalog)}
                multiline={a.action_name === 'send_message' || a.action_name === 'add_private_note'}
                onChange={(v) => setAction(i, { action_params: v ? [v] : [] })}
              />
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remover ação ${i + 1}`}
              onClick={() => setRule({ ...rule, actions: rule.actions.filter((_, j) => j !== i) })}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost small"
          onClick={() => setRule({ ...rule, actions: [...rule.actions, newAction()] })}
        >
          <Plus size={14} /> Ação
        </button>
      </fieldset>
      <button className="btn primary" disabled={busy}>
        Criar automação
      </button>
    </form>
  );
}
