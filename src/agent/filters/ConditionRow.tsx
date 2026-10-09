import { Trash2 } from 'lucide-react';
import type { FilterCondition } from '../types';
import { FILTER_OPERATORS } from '../labels';
import { Button } from '../ui/Button';
import { KIND_OPERATORS, needsValue, toValue, type FilterAttribute } from './filterAttributes';

interface Props {
  index: number;
  condition: FilterCondition;
  attributes: FilterAttribute[];
  onChange: (condition: FilterCondition) => void;
  onRemove?: () => void;
}

const small = 'field !h-8 !py-1 min-w-0';

/** One Chatwoot filter row: attribute, operator and value (select, number, date or text). */
export function ConditionRow({ index, condition: c, attributes, onChange, onRemove }: Props) {
  const attribute = attributes.find((a) => a.key === c.attribute_key);
  const operators = KIND_OPERATORS[attribute?.kind || 'text'];
  const raw = c.values[0] === undefined ? '' : String(c.values[0]);
  const n = index + 1;
  const setValue = (text: string) => onChange({ ...c, values: toValue(attribute, c.filter_operator, text) });
  const valueType =
    c.filter_operator === 'days_before' || attribute?.kind === 'number'
      ? 'number'
      : attribute?.kind === 'date'
        ? 'date'
        : 'text';
  const choices =
    attribute?.kind === 'boolean'
      ? [
          { value: 'true', label: 'Sim' },
          { value: 'false', label: 'Não' },
        ]
      : attribute?.options;

  return (
    <div className="flex items-center gap-2">
      <select
        className={`${small} flex-1`}
        aria-label={`Atributo da condição ${n}`}
        value={c.attribute_key}
        onChange={(e) => {
          const next = attributes.find((a) => a.key === e.target.value)!;
          onChange({
            ...c,
            attribute_key: next.key,
            filter_operator: KIND_OPERATORS[next.kind][0],
            values: [],
          });
        }}
      >
        {attributes.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </select>
      <select
        className={`${small} flex-1`}
        aria-label={`Operador da condição ${n}`}
        value={c.filter_operator}
        onChange={(e) => onChange({ ...c, filter_operator: e.target.value, values: [] })}
      >
        {operators.map((o) => (
          <option key={o} value={o}>
            {FILTER_OPERATORS[o]}
          </option>
        ))}
      </select>
      {needsValue(c.filter_operator) &&
        (choices && c.filter_operator !== 'days_before' ? (
          <select
            className={`${small} flex-1`}
            aria-label={`Valor da condição ${n}`}
            value={raw}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Selecione…</option>
            {choices.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${small} flex-1`}
            aria-label={`Valor da condição ${n}`}
            type={valueType}
            value={raw}
            onChange={(e) => setValue(e.target.value)}
          />
        ))}
      {onRemove && (
        <Button
          color="slate"
          variant="ghost"
          size="xs"
          icon={Trash2}
          aria-label={`Remover condição ${n}`}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
