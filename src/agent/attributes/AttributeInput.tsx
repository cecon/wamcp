import { useState } from 'react';
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
  return (
    <div className="flex flex-col gap-1">
      {d.attribute_display_type === 'checkbox' ? (
        <label className="flex items-center gap-2 text-sm text-n-slate-12">
          <input type="checkbox" checked={value === true} onChange={(e) => void commit(e.target.checked)} />
          {label}
        </label>
      ) : (
        <label className="block">
          <span className="mb-1 block text-sm text-n-slate-12">{label}</span>
          {d.attribute_display_type === 'list' ? (
            <select className="field" value={current} onChange={(e) => void commit(e.target.value || null)}>
              <option value="">—</option>
              {d.attribute_values.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="field"
              type={INPUT_TYPE[d.attribute_display_type] || 'text'}
              value={draft}
              step="any"
              onChange={(e) => {
                setDraft(e.target.value);
                if (d.attribute_display_type === 'date') void commit(parseAttribute(d, e.target.value));
              }}
              onBlur={() => {
                if (d.attribute_display_type !== 'date') void commit(parseAttribute(d, draft));
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void commit(parseAttribute(d, draft));
              }}
            />
          )}
        </label>
      )}
      {error ? (
        <p role="alert" className="text-xs text-n-ruby-11">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-n-slate-11">{hint}</p>
      )}
    </div>
  );
}
