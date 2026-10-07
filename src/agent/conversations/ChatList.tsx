import { ArrowUpDown } from 'lucide-react';
import type { Catalog, Conversation, ConversationStatus, Meta } from '../types';
import { STATUS_LABEL } from '../labels';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { Dropdown } from '../ui/Overlay';
import { ConversationCard } from './ConversationCard';

export type AssigneeType = 'me' | 'unassigned' | 'all';
export type StatusFilter = ConversationStatus | 'all';

const TABS: { id: AssigneeType; label: string; count: keyof Meta }[] = [
  { id: 'me', label: 'Minhas', count: 'mine' },
  { id: 'unassigned', label: 'Não atribuídas', count: 'unassigned' },
  { id: 'all', label: 'Todas', count: 'all' },
];
const CHIP: Record<StatusFilter, string> = {
  open: 'Abertas',
  pending: 'Pendentes',
  snoozed: 'Adiadas',
  resolved: 'Resolvidas',
  all: 'Todas',
};

interface Props {
  title: string;
  items: Conversation[];
  meta: Meta;
  status: StatusFilter;
  tab: AssigneeType;
  catalog: Catalog;
  selected?: number;
  hasMore: boolean;
  error: string;
  onStatus: (status: StatusFilter) => void;
  onTab: (tab: AssigneeType) => void;
  onSelect: (displayId: number) => void;
  onMore: () => void;
}

/** Chatwoot ChatList: 52px header with status chip and filter popover, Mine/Unassigned/All tabs, cards. */
export function ChatList({
  title,
  items,
  meta,
  status,
  tab,
  catalog,
  selected,
  hasMore,
  error,
  ...on
}: Props) {
  return (
    <section
      aria-label="Lista de conversas"
      className="flex h-full w-full shrink-0 flex-col bg-n-surface-1 md:w-[340px] 2xl:w-[412px]"
    >
      <header className="flex h-[3.25rem] items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center">
          <h1 className="truncate text-base font-medium text-n-slate-12">{title}</h1>
          <span className="mx-1 rounded-md bg-n-slate-3 px-2 py-1 text-xxs capitalize text-n-slate-12">
            {CHIP[status]}
          </span>
        </div>
        <Dropdown
          className="w-72 p-4"
          trigger={({ toggle }) => (
            <Button
              color="slate"
              variant="faded"
              size="xs"
              icon={ArrowUpDown}
              aria-label="Filtrar por status"
              onClick={toggle}
            />
          )}
        >
          {(close) => (
            <label className="flex items-center justify-between gap-3 text-sm text-n-slate-12">
              Status
              <select
                className="field !h-8 !w-40 !py-1"
                value={status}
                onChange={(e) => {
                  on.onStatus(e.target.value as StatusFilter);
                  close();
                }}
              >
                {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
                  <option key={s} value={s}>
                    {CHIP[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Dropdown>
      </header>
      <nav role="tablist" className="flex h-10 items-end border-b border-n-weak px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => on.onTab(t.id)}
            className={cn(
              'relative mx-2 flex items-center gap-1.5 py-2.5 text-sm font-medium first:ml-0',
              tab === t.id ? 'text-n-blue-11' : 'text-n-slate-11 hover:text-n-slate-12',
            )}
          >
            {t.label}
            <span
              className={cn(
                'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium',
                tab === t.id ? 'bg-n-blue-3 text-n-blue-11' : 'bg-n-alpha-1 text-n-slate-10',
              )}
            >
              {meta[t.count]}
            </span>
            {tab === t.id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-n-brand" />}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-4 text-sm text-n-ruby-11">{error}</p>}
        <ul>
          {items.map((c) => (
            <ConversationCard
              key={c.id}
              conversation={c}
              labels={catalog.labels}
              selected={selected === c.display_id}
              onSelect={() => on.onSelect(c.display_id)}
            />
          ))}
        </ul>
        {items.length === 0 && !error && (
          <p className="p-4 text-center text-sm text-n-slate-11">Não há conversas ativas neste grupo.</p>
        )}
        {hasMore && (
          <div className="p-3">
            <Button
              color="slate"
              variant="faded"
              className="w-full"
              label="Carregar mais"
              onClick={on.onMore}
            />
          </div>
        )}
      </div>
    </section>
  );
}
