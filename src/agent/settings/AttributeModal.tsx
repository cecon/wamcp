import { useState } from 'react';
import { http } from '../api';
import type { AttributeDefinition, AttributeDisplayType, FilterType } from '../types';
import { ATTRIBUTE_MODEL_LABEL, ATTRIBUTE_TYPE_LABEL } from '../labels';
import { Modal } from '../ui/Overlay';
import { ModalFooter } from '../ui/Settings';
import { useAction } from './useAction';

interface Props {
  definition: AttributeDefinition | null;
  model: FilterType;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}

const blankToNull = (text: string) => text.trim() || null;

/** Add/edit a custom attribute; key, model and type are fixed after creation (as in Chatwoot). */
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

  function submit() {
    const common = {
      attribute_display_name: form.name.trim(),
      attribute_description: blankToNull(form.description),
      attribute_values:
        form.type === 'list'
          ? form.values
              .split(',')
              .map((v) => v.trim())
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
    <Modal title={d ? 'Editar atributo' : 'Adicionar atributo'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          <span className="field-label">Aplica-se a</span>
          <select
            className="field"
            value={form.model}
            disabled={Boolean(d)}
            onChange={(e) => set({ model: e.target.value as FilterType })}
          >
            {(['conversation', 'contact'] as const).map((m) => (
              <option key={m} value={m}>
                {ATTRIBUTE_MODEL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Nome de exibição</span>
          <input
            className="field"
            value={form.name}
            maxLength={80}
            required
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Chave</span>
          <input
            className="field"
            value={form.key}
            maxLength={60}
            disabled={Boolean(d)}
            placeholder="gerada a partir do nome"
            onChange={(e) => set({ key: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <textarea
            className="field"
            value={form.description}
            maxLength={500}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Tipo</span>
          <select
            className="field"
            value={form.type}
            disabled={Boolean(d)}
            onChange={(e) => set({ type: e.target.value as AttributeDisplayType })}
          >
            {Object.entries(ATTRIBUTE_TYPE_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {form.type === 'list' && (
          <label>
            <span className="field-label">Opções da lista (separadas por vírgula)</span>
            <input
              className="field"
              value={form.values}
              required
              onChange={(e) => set({ values: e.target.value })}
            />
          </label>
        )}
        {isText && (
          <>
            <label>
              <span className="field-label">Padrão (regex)</span>
              <input
                className="field"
                value={form.pattern}
                placeholder="^[A-Z]{3}-\d+$"
                onChange={(e) => set({ pattern: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Dica do padrão</span>
              <input
                className="field"
                value={form.cue}
                maxLength={200}
                onChange={(e) => set({ cue: e.target.value })}
              />
            </label>
          </>
        )}
        <ModalFooter busy={busy} submit={d ? 'Salvar' : 'Criar'} onCancel={onClose} error={error} />
      </form>
    </Modal>
  );
}
