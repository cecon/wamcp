import type { ReactNode } from 'react';
import { ArrowLeft, Pencil as PencilIcon, Search, Trash2 as TrashIcon } from 'lucide-react';
import { Button } from './Button';

interface HeaderProps {
  title: string;
  description?: string;
  back?: { label: string; onClick: () => void };
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  count?: string;
  action?: ReactNode;
}

/** Chatwoot BaseSettingsHeader: title, description, then search · count | primary button. */
export function SettingsHeader({ title, description, back, search, count, action }: HeaderProps) {
  return (
    <header className="flex flex-col">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="mb-2 inline-flex items-center gap-1 self-start text-sm text-n-slate-11 hover:text-n-slate-12"
        >
          <ArrowLeft size={14} /> {back.label}
        </button>
      )}
      <h1 className="text-heading-1 mb-2 min-h-8 text-n-slate-12">{title}</h1>
      {description && <p className="text-body-main max-w-3xl text-n-slate-11">{description}</p>}
      {(search || count || action) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {search ? (
            <label className="relative">
              <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-n-slate-10" />
              <input
                className="field !h-8 w-56 !rounded-[10px] pl-8"
                value={search.value}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                onChange={(e) => search.onChange(e.target.value)}
              />
            </label>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {count && <span className="text-body-main text-n-slate-11">{count}</span>}
            {count && action && <span className="h-3 w-px bg-n-weak" />}
            {action}
          </div>
        </div>
      )}
    </header>
  );
}

/** Chatwoot settings page wrapper: centered max-w-5xl column on surface-1. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-auto bg-n-surface-1 px-6 pt-4 pb-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">{children}</div>
    </div>
  );
}

interface TableProps {
  headers: ReactNode[];
  empty: string;
  children: ReactNode;
  rows: number;
}

/** Chatwoot components-next/table/BaseTable.vue. */
export function Table({ headers, empty, children, rows }: TableProps) {
  return (
    <table className="w-full divide-y divide-n-weak border-t border-n-weak">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} className="text-heading-3 py-4 pr-4 text-start text-n-slate-12">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-n-weak">
        {rows === 0 ? (
          <tr>
            <td colSpan={headers.length} className="py-20 text-center text-base text-n-slate-12">
              {empty}
            </td>
          </tr>
        ) : (
          children
        )}
      </tbody>
    </table>
  );
}

export const Cell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={`text-body-main py-3 pr-4 align-middle text-n-slate-11 ${className || ''}`}>{children}</td>
);

/** Edit / delete icon buttons used on every settings row. */
export function RowActions({
  onEdit,
  onDelete,
  labelFor,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  labelFor: string;
}) {
  return (
    <div className="flex justify-end gap-1">
      {onEdit && (
        <Button
          color="slate"
          variant="faded"
          size="sm"
          icon={PencilIcon}
          aria-label={`Editar ${labelFor}`}
          onClick={onEdit}
        />
      )}
      {onDelete && (
        <Button
          color="slate"
          variant="faded"
          size="sm"
          icon={TrashIcon}
          aria-label={`Excluir ${labelFor}`}
          className="hover:bg-n-ruby-2 hover:text-n-ruby-11"
          onClick={onDelete}
        />
      )}
    </div>
  );
}

export function ModalFooter({
  busy,
  submit,
  onCancel,
  error,
}: {
  busy?: boolean;
  submit: string;
  onCancel: () => void;
  error?: string;
}) {
  return (
    <>
      {error && <p className="mt-3 text-sm text-n-ruby-11">{error}</p>}
      <div className="flex justify-end gap-2 pt-6">
        <Button color="slate" variant="faded" label="Cancelar" onClick={onCancel} />
        <Button type="submit" label={submit} disabled={busy} />
      </div>
    </>
  );
}

/** Switch row (label + hint left, switch right); `compact` renders only the switch, e.g. inside tables. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  compact,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <label
      className={
        compact ? 'inline-flex cursor-pointer' : 'flex cursor-pointer items-start justify-between gap-4 py-3'
      }
    >
      <span className={compact ? 'sr-only' : undefined}>
        <span className="text-heading-3 block text-n-slate-12">{label}</span>
        {hint && <span className="text-sm text-n-slate-11">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-n-slate-6 transition-colors peer-checked:bg-n-brand peer-focus-visible:ring-2 peer-focus-visible:ring-n-brand after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}
