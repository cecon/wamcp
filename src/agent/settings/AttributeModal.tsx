import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

// C3Theme
import { ActionDialog, SelectField } from '@c3theme/ui';

import { http } from '../api';
import type { AttributeDefinition, AttributeDisplayType, FilterType } from '../types';
import { ATTRIBUTE_MODEL_LABEL, ATTRIBUTE_TYPE_LABEL } from '../labels';
import { useAction } from './useAction';

interface Props {
  definition: AttributeDefinition | null;
  model: FilterType;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}

const blankToNull = (text: string) => text.trim() || null;

/**
 * Criar/editar atributo no `ActionDialog` do pacote (lote 3). Modelo, chave e tipo seguem fixos depois de criado, e
 * os selects continuam **nativos** (`SelectField native`) para não mudar a semântica de formulário nem os testes.
 */
export function AttributeModal({ definition: d, model, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    model: d?.attribute_model || model,
    name: d?.attribute_display_name || '',
    key: d?.attribute_key || '',
    description: d?.attribute_description || '',
    type: d?.attribute_display_type || ('text' as AttributeDisplayType),
    values: (d?.attribute_values || []).join(', '),
    pattern: d?.regex_pattern || '',
    cue: d?.regex_cue || '',
  });
  const { error, busy, run } = useAction();
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const isText = form.type === 'text';
  const isEdit = Boolean(d);

  function submit() {
    const common = {
      attribute_display_name: form.name.trim(),
      attribute_description: blankToNull(form.description),
      attribute_values:
        form.type === 'list'
          ? form.values
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined,
      regex_pattern: isText ? blankToNull(form.pattern) : null,
      regex_cue: isText ? blankToNull(form.cue) : null,
    };
    return run(async () => {
      if (d) await http(`/custom_attribute_definitions/${d.id}`, 'PATCH', common);
      else
        await http('/custom_attribute_definitions', 'POST', {
          ...common,
          attribute_model: form.model,
          attribute_key: blankToNull(form.key) ?? undefined,
          attribute_display_type: form.type,
        });
      await onSaved();
      onClose();
    });
  }

  return (
    <ActionDialog
      open
      title={d ? 'Editar atributo' : 'Adicionar atributo'}
      confirmLabel={d ? 'Salvar' : 'Criar'}
      backLabel="Cancelar"
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void submit()}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <SelectField
          native
          label="Aplica-se a"
          size="small"
          value={form.model}
          disabled={isEdit}
          onChange={(value) => value && set({ model: value as FilterType })}
          options={(['conversation', 'contact'] as const).map((value) => ({
            value,
            label: ATTRIBUTE_MODEL_LABEL[value],
          }))}
        />
        <TextField
          label="Nome de exibição"
          size="small"
          required
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />
        <TextField
          label="Chave"
          size="small"
          value={form.key}
          disabled={isEdit}
          placeholder="gerada a partir do nome"
          onChange={(event) => set({ key: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        <TextField
          label="Descrição"
          size="small"
          multiline
          minRows={2}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        <SelectField
          native
          label="Tipo"
          size="small"
          value={form.type}
          disabled={isEdit}
          onChange={(value) => value && set({ type: value as AttributeDisplayType })}
          options={Object.entries(ATTRIBUTE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {form.type === 'list' && (
          <TextField
            label="Opções da lista (separadas por vírgula)"
            size="small"
            required
            value={form.values}
            onChange={(event) => set({ values: event.target.value })}
          />
        )}
        {isText && (
          <>
            <TextField
              label="Padrão (regex)"
              size="small"
              value={form.pattern}
              placeholder="^[A-Z]{3}-\d+$"
              onChange={(event) => set({ pattern: event.target.value })}
            />
            <TextField
              label="Dica do padrão"
              size="small"
              value={form.cue}
              onChange={(event) => set({ cue: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          </>
        )}
      </Stack>
    </ActionDialog>
  );
}
