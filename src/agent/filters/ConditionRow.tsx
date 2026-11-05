// material-ui
import IconButton from '@mui/material/IconButton';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// third-party
import { Trash2 } from 'lucide-react';

import type { FilterCondition } from '../types';
import { FILTER_OPERATORS } from '../labels';
import { KIND_OPERATORS, needsValue, toValue, type FilterAttribute } from './filterAttributes';

interface Props {
  index: number;
  condition: FilterCondition;
  attributes: FilterAttribute[];
  onChange: (condition: FilterCondition) => void;
  onRemove?: () => void;
}

const selectSx = {
  flex: 1,
  minWidth: 0,
  '& .MuiNativeSelect-select': { py: 0.75, fontSize: 14 },
} as const;

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
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Select
        native
        size="small"
        value={c.attribute_key}
        inputProps={{ 'aria-label': `Atributo da condição ${n}` }}
        onChange={(event) => {
          const next = attributes.find((a) => a.key === String(event.target.value))!;
          onChange({
            ...c,
            attribute_key: next.key,
            filter_operator: KIND_OPERATORS[next.kind][0],
            values: [],
          });
        }}
        sx={selectSx}
      >
        {attributes.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </Select>
      <Select
        native
        size="small"
        value={c.filter_operator}
        inputProps={{ 'aria-label': `Operador da condição ${n}` }}
        onChange={(event) => onChange({ ...c, filter_operator: String(event.target.value), values: [] })}
        sx={selectSx}
      >
        {operators.map((o) => (
          <option key={o} value={o}>
            {FILTER_OPERATORS[o]}
          </option>
        ))}
      </Select>
      {needsValue(c.filter_operator) &&
        (choices && c.filter_operator !== 'days_before' ? (
          <Select
            native
            size="small"
            value={raw}
            inputProps={{ 'aria-label': `Valor da condição ${n}` }}
            onChange={(event) => setValue(String(event.target.value))}
            sx={selectSx}
          >
            <option value="">Selecione…</option>
            {choices.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <TextField
            size="small"
            type={valueType}
            value={raw}
            onChange={(event) => setValue(event.target.value)}
            slotProps={{ htmlInput: { 'aria-label': `Valor da condição ${n}` } }}
            sx={{ flex: 1, minWidth: 0 }}
          />
        ))}
      {onRemove && (
        <IconButton size="small" aria-label={`Remover condição ${n}`} onClick={onRemove}>
          <Trash2 size={14} />
        </IconButton>
      )}
    </Stack>
  );
}
