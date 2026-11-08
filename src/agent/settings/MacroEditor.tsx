import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { Macro, MacroVisibility } from '../accountTypes';
import type { Action, Catalog } from '../types';
import { ActionsEditor } from './ActionsEditor';
import { newAction } from './ruleOptions';

export interface MacroDraft {
  name: string;
  visibility: MacroVisibility;
  actions: Action[];
}

const VISIBILITY: { value: MacroVisibility; label: string; description: string }[] = [
  {
    value: 'personal',
    label: 'Privada',
    description: 'Esta macro será privada para você e não estará disponível para outras pessoas.',
  },
  {
    value: 'global',
    label: 'Pública',
    description: 'Esta macro está disponível para todos os agentes desta conta.',
  },
];

interface Props {
  macro?: Macro;
  catalog: Catalog;
  isAdmin: boolean;
  busy: boolean;
  error: string;
  onSave: (draft: MacroDraft) => void;
  onCancel: () => void;
}

/** Chatwoot MacroEditor: name, visibility (public only for administrators) and ordered actions. */
export function MacroEditor({ macro, catalog, isAdmin, busy, error, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<MacroDraft>({
    name: macro?.name || '',
    visibility: macro?.visibility || 'personal',
    actions: macro?.actions.length ? macro.actions : [newAction()],
  });
  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <TextField
        label="Nome da macro"
        size="small"
        value={draft.name}
        placeholder="Digite um nome para sua macro"
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 120, required: true } }}
      />
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Typography component="legend" variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
          Visibilidade da macro
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {VISIBILITY.map((v) => {
            const locked = v.value === 'global' && !isAdmin;
            const selected = draft.visibility === v.value;
            return (
              <FormControlLabel
                key={v.value}
                value={v.value}
                checked={selected}
                disabled={locked}
                onChange={() => setDraft({ ...draft, visibility: v.value })}
                control={<Radio name="macro-visibility" size="small" />}
                sx={{
                  alignItems: 'flex-start',
                  m: 0,
                  flex: 1,
                  px: 1.5,
                  py: 1,
                  border: 1,
                  borderColor: selected ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  opacity: locked ? 0.6 : 1,
                }}
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {v.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {locked ? 'Somente administradores podem criar macros públicas.' : v.description}
                    </Typography>
                  </Box>
                }
              />
            );
          })}
        </Stack>
      </Box>
      <ActionsEditor
        actions={draft.actions}
        catalog={catalog}
        onChange={(actions) => setDraft((d) => ({ ...d, actions }))}
      />
      <Typography variant="caption" color="text.secondary">
        As ações são executadas na ordem em que aparecem.
      </Typography>
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
          Salvar macro
        </Button>
      </Stack>
    </Stack>
  );
}
