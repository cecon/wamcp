import { small } from './ruleOptions';

interface ValueProps {
  id: string;
  value: string;
  options: [string, string][] | null;
  multiline?: boolean;
  onChange: (value: string) => void;
}

export function ValueInput({ id, value, options, multiline, onChange }: ValueProps) {
  if (options)
    return (
      <select aria-label={id} className={small} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione…</option>
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    );
  return multiline ? (
    <textarea
      aria-label={id}
      className="field basis-full"
      value={value}
      rows={2}
      maxLength={4096}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input
      aria-label={id}
      className={small}
      value={value}
      maxLength={200}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
