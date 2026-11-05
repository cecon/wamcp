import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog, SelectField } from '@c3theme/ui';

import { http } from '../api';
import type { SlaPolicy } from '../parityTypes';
import {
  splitThreshold,
  THRESHOLDS,
  toSeconds,
  UNIT_LABEL,
  type ThresholdKey,
  type ThresholdUnit,
} from '../sla/sla';
import { useAction } from './useAction';

type Targets = Record<ThresholdKey, { value: string; unit: ThresholdUnit }>;

interface Props {
  policy: SlaPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Chatwoot SLA form: name, description and the three targets in minutes, hours or days. */
export function SlaModal({ policy, onClose, onSaved }: Props) {
  const [name, setName] = useState(policy?.name || ''),
    [description, setDescription] = useState(policy?.description || ''),
    [targets, setTargets] = useState<Targets>(
      () =>
        Object.fromEntries(
          THRESHOLDS.map(({ key }) => [key, splitThreshold(policy?.[key] ?? null)]),
        ) as Targets,
    );
  const { error, busy, run } = useAction();
  const setTarget = (key: ThresholdKey, patch: Partial<Targets[ThresholdKey]>) =>
    setTargets((t) => ({ ...t, [key]: { ...t[key], ...patch } }));

  return (
    <ActionDialog
      open
      title={policy ? 'Editar SLA' : 'Adicionar SLA'}
      description="Defina ao menos um prazo. Os prazos contam a partir da aplicação do SLA na conversa."
      confirmLabel="Salvar"
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          const body = {
            name: name.trim(),
            description: description.trim() || null,
            ...Object.fromEntries(
              THRESHOLDS.map(({ key }) => [key, toSeconds(targets[key].value, targets[key].unit)]),
            ),
          };
          await http(policy ? `/sla_policies/${policy.id}` : '/sla_policies', policy ? 'PUT' : 'POST', body);
          onSaved();
          onClose();
        })
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Nome"
          size="small"
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { required: true, maxLength: 80 } }}
        />
        <TextField
          label="Descrição"
          size="small"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        {THRESHOLDS.map(({ key, label }) => (
          <Stack key={key} direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
            <TextField
              label={label}
              size="small"
              type="number"
              placeholder="Sem prazo"
              value={targets[key].value}
              onChange={(event) => setTarget(key, { value: event.target.value })}
              slotProps={{ htmlInput: { min: 1, step: 'any' } }}
              sx={{ flex: 1 }}
            />
            <SelectField
              native
              size="small"
              label={`Unidade ${label}`}
              value={targets[key].unit}
              onChange={(value) => value && setTarget(key, { unit: value as ThresholdUnit })}
              options={Object.entries(UNIT_LABEL).map(([unit, unitLabel]) => ({
                value: unit,
                label: unitLabel,
              }))}
              sx={{ width: 128 }}
            />
          </Stack>
        ))}
      </Stack>
    </ActionDialog>
  );
}
