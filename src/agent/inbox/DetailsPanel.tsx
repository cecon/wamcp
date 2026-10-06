import type { CSSProperties } from 'react';
import { Phone, Tag, UserRound, Users } from 'lucide-react';
import { http, initials } from '../api';
import type { Catalog, Conversation, User } from '../types';

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
}

/** Right-hand panel: contact, assignee, team and labels (Chatwoot's conversation sidebar). */
export function DetailsPanel({ conversation, user, catalog, onChange, onError }: Props) {
  const path = `/conversations/${conversation.display_id}`;
  const run = (promise: Promise<Conversation>) =>
    promise.then(onChange).catch((e: Error) => onError(e.message));
  const assignable = catalog.agents.filter(
    (a) => a.active && (a.role === 'administrator' || a.inbox_ids?.includes(conversation.inbox_id)),
  );
  const toggleLabel = (title: string) => {
    const next = conversation.labels.includes(title)
      ? conversation.labels.filter((l) => l !== title)
      : [...conversation.labels, title];
    void run(http<Conversation>(`${path}/labels`, 'POST', { labels: next }));
  };
  return (
    <aside className="details">
      <div className="contact-card">
        <span className="avatar large">
          {initials(conversation.contact_name || conversation.contact_phone)}
        </span>
        <strong>{conversation.contact_name || 'Sem nome'}</strong>
        {conversation.contact_phone && (
          <a href={`tel:${conversation.contact_phone}`}>
            <Phone size={13} /> {conversation.contact_phone}
          </a>
        )}
        <small className="muted">{conversation.contact_jid}</small>
      </div>
      <label>
        <span>
          <UserRound size={14} /> Responsável
        </span>
        <select
          value={conversation.assignee_id ?? ''}
          onChange={(e) =>
            void run(
              http(`${path}/assignments`, 'POST', {
                assignee_id: e.target.value ? Number(e.target.value) : null,
              }),
            )
          }
        >
          <option value="">Ninguém</option>
          {assignable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id === user.id ? `${a.name} (você)` : a.name}
              {a.availability !== 'online' ? ` · ${a.availability === 'busy' ? 'ocupado' : 'offline'}` : ''}
            </option>
          ))}
        </select>
      </label>
      {conversation.assignee_id !== user.id && (
        <button
          className="btn ghost small full"
          onClick={() => void run(http(`${path}/assignments`, 'POST', { assignee_id: user.id }))}
        >
          Assumir conversa
        </button>
      )}
      <label>
        <span>
          <Users size={14} /> Time
        </span>
        <select
          value={conversation.team_id ?? ''}
          onChange={(e) =>
            void run(
              http(`${path}/assignments`, 'POST', {
                team_id: e.target.value ? Number(e.target.value) : null,
              }),
            )
          }
        >
          <option value="">Nenhum</option>
          {catalog.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="label-picker">
        <span>
          <Tag size={14} /> Etiquetas
        </span>
        {catalog.labels.length === 0 && <small className="muted">Nenhuma etiqueta cadastrada.</small>}
        <div>
          {catalog.labels.map((l) => (
            <button
              key={l.id}
              className={`label-chip ${conversation.labels.includes(l.title) ? 'on' : ''}`}
              style={{ '--label': l.color } as CSSProperties}
              onClick={() => toggleLabel(l.title)}
              aria-pressed={conversation.labels.includes(l.title)}
            >
              {l.title}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
