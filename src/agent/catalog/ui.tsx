import { useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../ui/cn';
import { moneyText, parseMoney } from './format';

interface MoneyProps {
  label: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  /** Empty means `null` (e.g. the "de" price) instead of 0. */
  nullable?: boolean;
  /** Only the input (label kept for screen readers), for grids. */
  compact?: boolean;
}

/** Money field in reais ("29,90") that reports cents. */
export function MoneyInput({ label, value, onChange, nullable, compact }: MoneyProps) {
  const [text, setText] = useState(() => (value ? moneyText(value) : ''));
  const input = (
    <span className="relative block">
      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-n-slate-10">R$</span>
      <input
        className={cn('field pl-9', compact && '!h-8 min-w-24')}
        inputMode="decimal"
        aria-label={label}
        value={text}
        placeholder={nullable ? '—' : '0,00'}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseMoney(e.target.value) ?? (nullable ? null : 0));
        }}
      />
    </span>
  );
  if (compact) return input;
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {input}
    </label>
  );
}

type Tone = 'slate' | 'amber' | 'ruby' | 'teal' | 'blue';
const TONES: Record<Tone, string> = {
  slate: 'bg-n-slate-3 text-n-slate-11',
  amber: 'bg-n-amber-3 text-n-amber-11',
  ruby: 'bg-n-ruby-4 text-n-ruby-11',
  teal: 'bg-n-teal-3 text-n-teal-11',
  blue: 'bg-n-blue-3 text-n-blue-11',
};

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium', TONES[tone])}>
      {children}
    </span>
  );
}

/** Product photo or a placeholder square. */
export function Thumb({ src, alt, size = 56 }: { src: string | null; alt: string; size?: number }) {
  const style = { width: size, height: size };
  if (!src)
    return (
      <span
        style={style}
        className="grid shrink-0 place-content-center rounded-lg bg-n-slate-3 text-n-slate-10"
        aria-hidden
      >
        <ImageOff size={18} />
      </span>
    );
  return <img src={src} alt={alt} style={style} className="shrink-0 rounded-lg object-cover" />;
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="list-disc rounded-lg bg-n-ruby-2 py-2 pr-3 pl-7 text-sm text-n-ruby-11">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

/** Titled block inside the item editor. */
export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 border-t border-n-weak pt-5 first:border-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-heading-3 text-n-slate-12">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function TextField({
  label,
  value,
  onChange,
  max,
  required,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const props = {
    className: 'field',
    value,
    maxLength: max,
    required,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} />}
    </label>
  );
}
