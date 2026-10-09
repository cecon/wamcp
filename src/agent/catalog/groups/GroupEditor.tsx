import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../../settings/useAction';
import { catalogApi } from '../catalogApi';
import { GROUP_TYPE_LABEL } from '../format';
import type { CatalogStatus, ComplementGroup, GroupType } from '../types';
import { ErrorList, TextField } from '../ui';
import { newOption, toGroupDraft, toGroupForm, validateGroup, type GroupForm } from './groupDraft';
import { OptionRow, type OptionRowDraft } from './OptionRow';

interface Props {
  group?: ComplementGroup;
  editable: boolean;
  onSaved: (group: ComplementGroup) => void;
  onCancel: () => void;
}

/** Complement group form: name, type, PDV code, status and its options. */
export function GroupEditor({ group, editable, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<GroupForm>(() => toGroupForm(group)),
    [errors, setErrors] = useState<string[]>([]);
  const { error, busy, run } = useAction();
  const set = (patch: Partial<GroupForm>) => setForm((f) => ({ ...f, ...patch }));
  const setOptions = (options: OptionRowDraft[]) => set({ options });
  const move = (i: number, step: -1 | 1) => {
    const options = [...form.options];
    [options[i], options[i + step]] = [options[i + step], options[i]];
    setOptions(options);
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const problems = validateGroup(form);
        setErrors(problems);
        if (problems.length) return;
        void run(async () => {
          const draft = toGroupDraft(form);
          onSaved(
            group ? await catalogApi.updateGroup(group.id, draft) : await catalogApi.createGroup(draft),
          );
        });
      }}
    >
      <fieldset disabled={!editable} className="flex flex-col gap-4">
        <TextField label="Nome do grupo" max={80} value={form.name} onChange={(name) => set({ name })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="field-label">Tipo</span>
            <select
              className="field"
              value={form.type}
              onChange={(e) => set({ type: e.target.value as GroupType })}
            >
              {Object.entries(GROUP_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Código PDV"
            max={60}
            value={form.external_code || ''}
            onChange={(v) => set({ external_code: v.trim() || null })}
          />
          <label className="block">
            <span className="field-label">Status</span>
            <select
              className="field"
              value={form.status}
              onChange={(e) => set({ status: e.target.value as CatalogStatus })}
            >
              <option value="available">Disponível</option>
              <option value="unavailable">Pausado</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="field-label">Opções</legend>
          <ul className="flex flex-col gap-2">
            {form.options.map((o, i) => (
              <OptionRow
                key={o.id ?? `new-${i}`}
                option={o}
                index={i}
                count={form.options.length}
                editable={editable}
                onChange={(patch) =>
                  setOptions(form.options.map((x, j) => (i === j ? { ...x, ...patch } : x)))
                }
                onMove={(step) => move(i, step)}
                onRemove={() => setOptions(form.options.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
          {editable && (
            <Button
              size="xs"
              variant="faded"
              icon={Plus}
              label="Adicionar opção"
              className="mt-2"
              onClick={() => setOptions([...form.options, newOption(form.options.length)])}
            />
          )}
        </fieldset>
      </fieldset>
      <ErrorList errors={errors} />
      {editable ? (
        <ModalFooter busy={busy} submit="Salvar grupo" onCancel={onCancel} error={error} />
      ) : (
        <Button color="slate" variant="faded" label="Fechar" className="self-end" onClick={onCancel} />
      )}
    </form>
  );
}
