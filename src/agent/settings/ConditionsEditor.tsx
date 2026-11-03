// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { Plus, Trash2 } from 'lucide-react';

import type { AttributeDefinition, Catalog, Condition } from '../types';
import { AUTOMATION_OPERATORS, CONDITION_ATTRIBUTES } from '../labels';
import { choices, CUSTOM_PREFIX, newCondition, NO_VALUE } from './ruleOptions';
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
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
        Condições
      </Typography>
      <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {conditions.map((c, i) => (
          <Stack
            component="li"
            key={i}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            {i > 0 && (
              <TextField
                select
                size="small"
                value={conditions[i - 1].query_operator}
                onChange={(e) => set(i - 1, { query_operator: e.target.value as 'and' | 'or' })}
                slotProps={{
                  select: { native: true },
                  inputLabel: { shrink: true },
                  htmlInput: { 'aria-label': `Junção ${i}` },
                }}
                sx={{ minWidth: 72 }}
              >
                <option value="and">E</option>
                <option value="or">OU</option>
              </TextField>
            )}
            <TextField
              select
              size="small"
              value={c.attribute_key}
              onChange={(e) => set(i, { attribute_key: e.target.value, values: [] })}
              slotProps={{
                select: { native: true },
                inputLabel: { shrink: true },
                htmlInput: { 'aria-label': `Atributo ${i + 1}` },
              }}
              sx={{ minWidth: 170 }}
            >
              {attributes.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              value={c.filter_operator}
              onChange={(e) => set(i, { filter_operator: e.target.value })}
              slotProps={{
                select: { native: true },
                inputLabel: { shrink: true },
                htmlInput: { 'aria-label': `Operador ${i + 1}` },
              }}
              sx={{ minWidth: 160 }}
            >
              {Object.entries(AUTOMATION_OPERATORS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </TextField>
            {!NO_VALUE.has(c.filter_operator) && (
              <ValueInput
                id={`Valor ${i + 1}`}
                value={String(c.values[0] ?? '')}
                options={choices(c.attribute_key, catalog, definitions)}
                onChange={(v) => set(i, { values: v ? [v] : [] })}
              />
            )}
            <IconButton
              size="small"
              color="error"
              aria-label={`Remover condição ${i + 1}`}
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </IconButton>
          </Stack>
        ))}
        <li>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Plus size={16} />}
            onClick={() => onChange([...conditions, newCondition()])}
          >
            Adicionar condição
          </Button>
        </li>
      </Stack>
    </Box>
  );
}
