import { useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { Action, Catalog, Condition } from '../types';
import { AUTOMATION_EVENTS } from '../labels';
import { useAttributeDefinitions } from '../attributes/useAttributeDefinitions';
import { ActionsEditor } from './ActionsEditor';
import { ConditionsEditor } from './ConditionsEditor';
import { newAction, newCondition } from './ruleOptions';

export interface RuleDraft {
  name: string;
  event_name: string;
  conditions: Condition[];
  actions: Action[];
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
  const { definitions } = useAttributeDefinitions('conversation');

  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rule);
      }}
    >
      <TextField
        label="Nome da regra"
        size="small"
        value={rule.name}
        onChange={(e) => setRule({ ...rule, name: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 120, required: true } }}
      />
      <TextField
        select
        label="Evento"
        size="small"
        value={rule.event_name}
        onChange={(e) => setRule({ ...rule, event_name: e.target.value })}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        {Object.entries(AUTOMATION_EVENTS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </TextField>
      <ConditionsEditor
        conditions={rule.conditions}
        catalog={catalog}
        definitions={definitions}
        onChange={(conditions) => setRule((r) => ({ ...r, conditions }))}
      />
      <ActionsEditor
        actions={rule.actions}
        catalog={catalog}
        onChange={(actions) => setRule((r) => ({ ...r, actions }))}
      />
      {error && (
        <Typography role="alert" variant="body2" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button type="button" variant="outlined" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" disabled={busy}>
          Criar automação
        </Button>
      </Stack>
    </Stack>
  );
}
