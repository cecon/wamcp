import { Bot, Search } from 'lucide-react';
import { formatTime, initials } from '../api';
import type { Catalog, Conversation, ConversationStatus, Meta } from '../types';
import { STATUS_LABEL } from '../labels';

export interface Filters {
  assigneeType: 'me' | 'unassigned' | 'all';
  status: ConversationStatus | 'all';
  inboxId?: number;
  label?: string;
  q: string;
}

const TABS: { id: Filters['assigneeType']; label: string; count: keyof Meta }[] = [
  { id: 'me', label: 'Minhas', count: 'mine' },
  { id: 'unassigned', label: 'Não atribuídas', count: 'unassigned' },
  { id: 'all', label: 'Todas', count: 'all' },
];

interface Props {
  items: Conversation[];
  meta: Meta;
  filters: Filters;
  catalog: Catalog;
  selected: number | null;
  hasMore: boolean;
  error: string;
  onFilters: (next: Partial<Filters>) => void;
  onSelect: (displayId: number) => void;
  onMore: () => void;
}

export function ConversationList({ items, meta, filters, catalog, selected, hasMore, error, ...on }: Props) {
  const labelColor = (title: string) => catalog.labels.find((l) => l.title === title)?.color || '#8b978e';
  return (
    <section className="conversation-list" aria-label="Conversas">
      <header>
        <div className="list-title">
          <h1>Conversas</h1>
          <select
            value={filters.status}
            onChange={(e) => on.onFilters({ status: e.target.value as Filters['status'] })}
            aria-label="Status"
          >
            {Object.entries(STATUS_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="search">
          <Search size={15} />
          <input
            placeholder="Buscar por nome ou telefone"
            value={filters.q}
            onChange={(e) => on.onFilters({ q: e.target.value })}
          />
        </label>
        <div className="list-filters">
          <select
            value={filters.inboxId ?? ''}
            onChange={(e) => on.onFilters({ inboxId: e.target.value ? Number(e.target.value) : undefined })}
            aria-label="Caixa de entrada"
          >
            <option value="">Todas as caixas</option>
            {catalog.inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <select
            value={filters.label ?? ''}
            onChange={(e) => on.onFilters({ label: e.target.value || undefined })}
            aria-label="Etiqueta"
          >
            <option value="">Todas as etiquetas</option>
            {catalog.labels.map((l) => (
              <option key={l.id} value={l.title}>
                {l.title}
              </option>
            ))}
          </select>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={filters.assigneeType === tab.id}
              className={filters.assigneeType === tab.id ? 'active' : ''}
              onClick={() => on.onFilters({ assigneeType: tab.id })}
            >
              {tab.label}
              <span>{meta[tab.count]}</span>
            </button>
          ))}
        </nav>
      </header>
      {error && <div className="form-error pad">{error}</div>}
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <button
              className={selected === c.display_id ? 'active' : ''}
              onClick={() => on.onSelect(c.display_id)}
            >
              <span className="avatar">{initials(c.contact_name || c.contact_phone)}</span>
              <span className="item-body">
                <span className="item-top">
                  <strong>{c.contact_name || c.contact_phone || 'Contato'}</strong>
                  <small>{formatTime(c.last_activity_at)}</small>
                </span>
                <span className="item-meta">
                  #{c.display_id} · {c.inbox_name}
                  {c.assignee_name ? ` · ${c.assignee_name}` : ''}
                  {c.status === 'pending' && <Bot size={13} aria-label="Com a IA" />}
                </span>
                <span className="item-preview">
                  <span>{c.last_message || '—'}</span>
                  {c.unread_count > 0 && <b className="unread">{c.unread_count}</b>}
                </span>
                {c.labels.length > 0 && (
                  <span className="item-labels">
                    {c.labels.map((l) => (
                      <i key={l} style={{ background: labelColor(l) }} title={l} />
                    ))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && !error && <p className="muted pad">Nenhuma conversa neste filtro.</p>}
      {hasMore && (
        <button className="btn ghost full" onClick={on.onMore}>
          Carregar mais
        </button>
      )}
    </section>
  );
}
