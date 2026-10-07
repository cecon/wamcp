import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Action, Catalog, Condition } from '../types';
import { ACTIONS, AUTOMATION_EVENTS, CONDITION_ATTRIBUTES, OPERATORS, PRIORITY_LABEL } from '../labels';
import { Button } from '../ui/Button';
import { ModalFooter } from '../ui/Settings';

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
const small = 'field !h-8 !w-auto flex-1 basis-36 !py-1';

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

interface ValueProps {
  id: string;
  value: string;
  options: [string, string][] | null;
  multiline?: boolean;
  onChange: (value: string) => void;
}
function ValueInput({ id, value, options, multiline, onChange }: ValueProps) {
  if (options)
    return (
      <select aria-label={id} className={small} value={value} onChange={(e) => onChange(e.target.value)}>
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
      className="field basis-full"
      value={value}
      rows={2}
      maxLength={4096}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input
      aria-label={id}
      className={small}
      value={value}
      maxLength={200}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface Props {
  catalog: Catalog;
  busy: boolean;
  error: string;
  onSave: (rule: RuleDraft) => void;
  onCancel: () => void;
}

/** Chatwoot automation form: name, event, conditions box and actions box (ConditionRow / ActionInput). */
export function RuleEditor({ catalog, busy, error, onSave, onCancel }: Props) {
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
  const box = 'grid gap-4 rounded-xl p-3 outline outline-1 -outline-offset-1 outline-n-weak';

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rule);
      }}
    >
      <label>
        <span className="field-label">Nome da regra</span>
        <input
          className="field"
          value={rule.name}
          maxLength={120}
          required
          onChange={(e) => setRule({ ...rule, name: e.target.value })}
        />
      </label>
      <label>
        <span className="field-label">Evento</span>
        <select
          className="field"
          value={rule.event_name}
          onChange={(e) => setRule({ ...rule, event_name: e.target.value })}
        >
          {Object.entries(AUTOMATION_EVENTS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="field-label">Condições</legend>
        <ul className={box}>
          {rule.conditions.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              {i > 0 && (
                <select
                  aria-label={`Junção ${i}`}
                  className="field !h-8 !w-20 !py-1"
                  value={rule.conditions[i - 1].query_operator}
                  onChange={(e) => setCondition(i - 1, { query_operator: e.target.value as 'and' | 'or' })}
                >
                  <option value="and">E</option>
                  <option value="or">OU</option>
                </select>
              )}
              <select
                aria-label={`Atributo ${i + 1}`}
                className={small}
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
                className={small}
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
              <Button
                color="slate"
                variant="faded"
                icon={Trash2}
                aria-label={`Remover condição ${i + 1}`}
                onClick={() => setRule({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}
              />
            </li>
          ))}
          <li>
            <Button
              variant="faded"
              icon={Plus}
              label="Adicionar condição"
              onClick={() => setRule({ ...rule, conditions: [...rule.conditions, newCondition()] })}
            />
          </li>
        </ul>
      </fieldset>
      <fieldset>
        <legend className="field-label">Ações</legend>
        <ul className={box}>
          {rule.actions.map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Ação ${i + 1}`}
                className={small}
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
              <Button
                color="slate"
                variant="faded"
                icon={Trash2}
                aria-label={`Remover ação ${i + 1}`}
                onClick={() => setRule({ ...rule, actions: rule.actions.filter((_, j) => j !== i) })}
              />
            </li>
          ))}
          <li>
            <Button
              variant="faded"
              icon={Plus}
              label="Adicionar ação"
              onClick={() => setRule({ ...rule, actions: [...rule.actions, newAction()] })}
            />
          </li>
        </ul>
      </fieldset>
      <ModalFooter busy={busy} submit="Criar automação" onCancel={onCancel} error={error} />
    </form>
  );
}
