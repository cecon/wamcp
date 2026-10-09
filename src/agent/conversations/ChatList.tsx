import { useState, type ReactNode } from 'react';
import type { Catalog, Conversation, Meta } from '../types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { BulkActionBar } from './BulkActionBar';
import { ChatListHeader, type StatusFilter } from './ChatListHeader';
import { ConversationCard } from './ConversationCard';

export type AssigneeType = 'me' | 'unassigned' | 'all';
export type { StatusFilter };

const TABS: { id: AssigneeType; label: string; count: keyof Meta }[] = [
  { id: 'me', label: 'Minhas', count: 'mine' },
  { id: 'unassigned', label: 'Não atribuídas', count: 'unassigned' },
  { id: 'all', label: 'Todas', count: 'all' },
];

interface Props {
  title: string;
  items: Conversation[];
  meta: Meta;
  status: StatusFilter;
  tab: AssigneeType;
  sort: string;
  filtering?: boolean;
  toolbar?: ReactNode;
  catalog: Catalog;
  selected?: number;
  hasMore: boolean;
  error: string;
  onStatus: (status: StatusFilter) => void;
  onTab: (tab: AssigneeType) => void;
  onSort: (sort: string) => void;
  onSelect: (displayId: number) => void;
  onMore: () => void;
  onReload: () => void;
}

/** Chatwoot ChatList: header, Mine/Unassigned/All tabs, bulk action bar and the conversation cards. */
export function ChatList({
  title,
  items,
  meta,
  status,
  tab,
  sort,
  filtering = false,
  toolbar,
  catalog,
  selected,
  hasMore,
  error,
  ...on
}: Props) {
  const [checked, setChecked] = useState<number[]>([]);
  const visible = checked.filter((id) => items.some((c) => c.display_id === id));
  const toggle = (id: number, value: boolean) =>
    setChecked((list) => (value ? [...list, id] : list.filter((x) => x !== id)));

  return (
    <section
      aria-label="Lista de conversas"
      className="flex h-full w-full shrink-0 flex-col bg-n-surface-1 md:w-[340px] 2xl:w-[412px]"
    >
      <ChatListHeader
        title={title}
        status={status}
        sort={sort}
        filtering={filtering}
        toolbar={toolbar}
        onStatus={on.onStatus}
        onSort={on.onSort}
      />
      {!filtering && (
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
      )}
      {visible.length > 0 && (
        <BulkActionBar
          selected={visible}
          total={items.length}
          catalog={catalog}
          onSelectAll={(all) => setChecked(all ? items.map((c) => c.display_id) : [])}
          onClear={() => setChecked([])}
          onDone={(updated) => {
            setChecked((list) => list.filter((id) => !updated.includes(id)));
            on.onReload();
          }}
        />
      )}
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
              checked={visible.includes(c.display_id)}
              selecting={visible.length > 0}
              onCheck={(value) => toggle(c.display_id, value)}
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
