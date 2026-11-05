import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { SelectField } from '@c3theme/ui';

import type { AttributeDefinition, FilterValue } from '../types';
import { parseAttribute, patternError } from './attributeValue';

type Value = FilterValue | null | undefined;

const INPUT_TYPE: Record<string, string> = {
  number: 'number',
  currency: 'number',
  percent: 'number',
  link: 'url',
  date: 'date',
};

interface Props {
  definition: AttributeDefinition;
  value: Value;
  onSave: (value: FilterValue | null) => Promise<void>;
}

/** One typed custom attribute (Chatwoot CustomAttribute.vue): saves on blur, Enter or change. */
export function AttributeInput({ definition: d, value, onSave }: Props) {
  const current = value == null ? '' : String(value);
  const [draft, setDraft] = useState(current),
    [error, setError] = useState(''),
    [saved, setSaved] = useState<Value>(value);
  const label = d.attribute_display_name;
  async function commit(next: FilterValue | null) {
    const invalid = patternError(d, next);
    setError(invalid);
    // Enter then blur, or a parent that has not re-rendered yet, must not save the same value twice.
    if (invalid || (next ?? '') === (saved ?? '')) return;
    try {
      await onSave(next);
      setSaved(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const hint = d.regex_cue || d.attribute_description;
  const feedback = error ? (
    <Typography variant="caption" role="alert" sx={{ display: 'block', color: 'error.main' }}>
      {error}
    </Typography>
  ) : (
    hint && (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {hint}
      </Typography>
    )
  );

  if (d.attribute_display_type === 'checkbox')
    return (
      <Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Checkbox
            size="small"
            checked={value === true}
            onChange={(event) => void commit(event.target.checked)}
            slotProps={{ input: { 'aria-label': label } }}
          />
          <Typography variant="body2">{label}</Typography>
        </Stack>
        {feedback}
      </Box>
    );

  return (
    <Box>
      {d.attribute_display_type === 'list' ? (
        <SelectField
          native
          label={label}
          size="small"
          emptyLabel="—"
          value={current}
          options={d.attribute_values.map((option) => ({ value: option, label: option }))}
          onChange={(next) => void commit(next)}
        />
      ) : (
        <TextField
          label={label}
          size="small"
          fullWidth
          type={INPUT_TYPE[d.attribute_display_type] || 'text'}
          value={draft}
          slotProps={{ htmlInput: { step: 'any' } }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (d.attribute_display_type === 'date') void commit(parseAttribute(d, event.target.value));
          }}
          onBlur={() => {
            if (d.attribute_display_type !== 'date') void commit(parseAttribute(d, draft));
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void commit(parseAttribute(d, draft));
          }}
        />
      )}
      {feedback}
    </Box>
  );
}
