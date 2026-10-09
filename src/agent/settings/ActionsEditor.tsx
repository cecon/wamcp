import { Plus, Trash2 } from 'lucide-react';
import type { Action, Catalog } from '../types';
import { ACTIONS } from '../labels';
import { Button } from '../ui/Button';
import { BOX, choices, newAction, NO_PARAM, small, TEXT_PARAM } from './ruleOptions';
import { ValueInput } from './ValueInput';
import { useSlaPolicies } from '../sla/sla';

interface Props {
  actions: Action[];
  catalog: Catalog;
  onChange: (actions: Action[]) => void;
}

/** Ordered action list shared by automation rules and macros (Chatwoot ActionInput). */
export function ActionsEditor({ actions, catalog, onChange }: Props) {
  // SLA policies are only fetched once an "Adicionar SLA" action exists.
  const { policies } = useSlaPolicies(actions.some((a) => a.action_name === 'add_sla'));
  const options = (name: string): [string, string][] | null =>
    name === 'add_sla' ? policies.map((p) => [String(p.id), p.name]) : choices(name, catalog);
  const set = (i: number, patch: Partial<Action>) =>
    onChange(actions.map((a, j) => (i === j ? { ...a, ...patch } : a)));
  return (
    <fieldset>
      <legend className="field-label">Ações</legend>
      <ul className={BOX}>
        {actions.map((a, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Ação ${i + 1}`}
              className={small}
              value={a.action_name}
              onChange={(e) => set(i, { action_name: e.target.value, action_params: [] })}
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
                options={options(a.action_name)}
                multiline={TEXT_PARAM.has(a.action_name)}
                onChange={(v) => set(i, { action_params: v ? [v] : [] })}
              />
            )}
            <Button
              color="slate"
              variant="faded"
              icon={Trash2}
              aria-label={`Remover ação ${i + 1}`}
              onClick={() => onChange(actions.filter((_, j) => j !== i))}
            />
          </li>
        ))}
        <li>
          <Button
            variant="faded"
            icon={Plus}
            label="Adicionar ação"
            onClick={() => onChange([...actions, newAction()])}
          />
        </li>
      </ul>
    </fieldset>
  );
}
