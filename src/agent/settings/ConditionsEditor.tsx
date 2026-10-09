import { Plus, Trash2 } from 'lucide-react';
import type { AttributeDefinition, Catalog, Condition } from '../types';
import { AUTOMATION_OPERATORS, CONDITION_ATTRIBUTES } from '../labels';
import { Button } from '../ui/Button';
import { BOX, choices, CUSTOM_PREFIX, newCondition, NO_VALUE, small } from './ruleOptions';
import { ValueInput } from './ValueInput';

interface Props {
  conditions: Condition[];
  catalog: Catalog;
  /** Conversation custom attributes, offered as `custom_attribute:<key>`. */
  definitions: AttributeDefinition[];
  onChange: (conditions: Condition[]) => void;
}

/** Automation conditions; `query_operator` joins a row to the next one, like Chatwoot. */
export function ConditionsEditor({ conditions, catalog, definitions, onChange }: Props) {
  const set = (i: number, patch: Partial<Condition>) =>
    onChange(conditions.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  const attributes: [string, string][] = [
    ...Object.entries(CONDITION_ATTRIBUTES),
    ...definitions.map((d): [string, string] => [
      `${CUSTOM_PREFIX}${d.attribute_key}`,
      d.attribute_display_name,
    ]),
  ];
  return (
    <fieldset>
      <legend className="field-label">Condições</legend>
      <ul className={BOX}>
        {conditions.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            {i > 0 && (
              <select
                aria-label={`Junção ${i}`}
                className="field !h-8 !w-20 !py-1"
                value={conditions[i - 1].query_operator}
                onChange={(e) => set(i - 1, { query_operator: e.target.value as 'and' | 'or' })}
              >
                <option value="and">E</option>
                <option value="or">OU</option>
              </select>
            )}
            <select
              aria-label={`Atributo ${i + 1}`}
              className={small}
              value={c.attribute_key}
              onChange={(e) => set(i, { attribute_key: e.target.value, values: [] })}
            >
              {attributes.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label={`Operador ${i + 1}`}
              className={small}
              value={c.filter_operator}
              onChange={(e) => set(i, { filter_operator: e.target.value })}
            >
              {Object.entries(AUTOMATION_OPERATORS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {!NO_VALUE.has(c.filter_operator) && (
              <ValueInput
                id={`Valor ${i + 1}`}
                value={String(c.values[0] ?? '')}
                options={choices(c.attribute_key, catalog, definitions)}
                onChange={(v) => set(i, { values: v ? [v] : [] })}
              />
            )}
            <Button
              color="slate"
              variant="faded"
              icon={Trash2}
              aria-label={`Remover condição ${i + 1}`}
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}
            />
          </li>
        ))}
        <li>
          <Button
            variant="faded"
            icon={Plus}
            label="Adicionar condição"
            onClick={() => onChange([...conditions, newCondition()])}
          />
        </li>
      </ul>
    </fieldset>
  );
}
