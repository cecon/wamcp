// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// third-party
import { Plus, Trash2 } from 'lucide-react';

import type { Action, Catalog } from '../types';
import { ACTIONS } from '../labels';
import { useSlaPolicies } from '../sla/sla';
import { choices, newAction, NO_PARAM, TEXT_PARAM } from './ruleOptions';
import { ValueInput } from './ValueInput';

interface Props {
  actions: Action[];
  catalog: Catalog;
  onChange: (actions: Action[]) => void;
}

/** Ordered action list shared by automation rules and macros (Chatwoot ActionInput), agora no C3Theme. */
export function ActionsEditor({ actions, catalog, onChange }: Props) {
  // SLA policies are only fetched once an "Adicionar SLA" action exists.
  const { policies } = useSlaPolicies(actions.some((a) => a.action_name === 'add_sla'));
  const options = (name: string): [string, string][] | null =>
    name === 'add_sla' ? policies.map((p) => [String(p.id), p.name]) : choices(name, catalog);
  const set = (i: number, patch: Partial<Action>) =>
    onChange(actions.map((a, j) => (i === j ? { ...a, ...patch } : a)));
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
        Ações
      </Typography>
      <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {actions.map((a, i) => (
          <Stack
            component="li"
            key={i}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <TextField
              select
              size="small"
              value={a.action_name}
              onChange={(e) => set(i, { action_name: e.target.value, action_params: [] })}
              slotProps={{
                select: { native: true },
                inputLabel: { shrink: true },
                htmlInput: { 'aria-label': `Ação ${i + 1}` },
              }}
              sx={{ minWidth: 190 }}
            >
              {Object.entries(ACTIONS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </TextField>
            {!NO_PARAM.has(a.action_name) && (
              <ValueInput
                id={`Parâmetro ${i + 1}`}
                value={String(a.action_params[0] ?? '')}
                options={options(a.action_name)}
                multiline={TEXT_PARAM.has(a.action_name)}
                onChange={(v) => set(i, { action_params: v ? [v] : [] })}
              />
            )}
            <IconButton
              size="small"
              color="error"
              aria-label={`Remover ação ${i + 1}`}
              onClick={() => onChange(actions.filter((_, j) => j !== i))}
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
            onClick={() => onChange([...actions, newAction()])}
          >
            Adicionar ação
          </Button>
        </li>
      </Stack>
    </Box>
  );
}
