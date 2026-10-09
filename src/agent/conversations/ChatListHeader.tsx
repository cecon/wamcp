import type { ReactNode } from 'react';
import { ArrowDownWideNarrow, ArrowUpDown } from 'lucide-react';
import type { ConversationStatus } from '../types';
import { SORT_LABEL, STATUS_LABEL } from '../labels';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Overlay';

export type StatusFilter = ConversationStatus | 'all';
const CHIP: Record<StatusFilter, string> = {
  open: 'Abertas',
  pending: 'Pendentes',
  snoozed: 'Adiadas',
  resolved: 'Resolvidas',
  all: 'Todas',
};

function SelectPopover<T extends string>({
  icon,
  label,
  field,
  value,
  options,
  onChange,
}: {
  icon: typeof ArrowUpDown;
  label: string;
  field: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <Dropdown
      className="w-80 p-4"
      trigger={({ toggle }) => (
        <Button color="slate" variant="faded" size="xs" icon={icon} aria-label={label} onClick={toggle} />
      )}
    >
      {(close) => (
        <label className="flex items-center justify-between gap-3 text-sm text-n-slate-12">
          {field}
          <select
            className="field !h-8 !w-52 !py-1"
            value={value}
            onChange={(e) => {
              onChange(e.target.value as T);
              close();
            }}
          >
            {(Object.keys(options) as T[]).map((s) => (
              <option key={s} value={s}>
                {options[s]}
              </option>
            ))}
          </select>
        </label>
      )}
    </Dropdown>
  );
}

const STATUS_OPTIONS = Object.fromEntries(
  (Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => [s, CHIP[s]]),
) as Record<StatusFilter, string>;

interface Props {
  title: string;
  status: StatusFilter;
  sort: string;
  /** Advanced filter active: status and sort do not apply to POST /conversations/filter. */
  filtering: boolean;
  toolbar?: ReactNode;
  onStatus: (status: StatusFilter) => void;
  onSort: (sort: string) => void;
}

/** Chatwoot ChatList header: title, status chip, filter/folder actions, sort and status popovers. */
export function ChatListHeader({ title, status, sort, filtering, toolbar, onStatus, onSort }: Props) {
  return (
    <header className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center">
        <h1 className="truncate text-base font-medium text-n-slate-12">{title}</h1>
        {!filtering && (
          <span className="mx-1 rounded-md bg-n-slate-3 px-2 py-1 text-xxs capitalize text-n-slate-12">
            {CHIP[status]}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {toolbar}
        {!filtering && (
          <>
            <SelectPopover
              icon={ArrowDownWideNarrow}
              label="Ordenar conversas"
              field="Ordenar por"
              value={sort}
              options={SORT_LABEL}
              onChange={onSort}
            />
            <SelectPopover
              icon={ArrowUpDown}
              label="Filtrar por status"
              field="Status"
              value={status}
              options={STATUS_OPTIONS}
              onChange={onStatus}
            />
          </>
        )}
      </div>
    </header>
  );
}
