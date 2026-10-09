import type { ReactNode } from 'react';
import { Contact as ContactIcon, MessageCircle, MessageSquareText } from 'lucide-react';
import { timeAgo } from '../api';
import type { SearchResults as Results } from '../parityTypes';
import { STATUS_LABEL } from '../labels';
import { Avatar } from '../ui/Avatar';
import { Highlight } from './Highlight';

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="flex items-center gap-2 px-2 pb-1 text-sm font-medium text-n-slate-11">
        {icon} {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function Hit({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-n-alpha-1"
      >
        {children}
      </button>
    </li>
  );
}

interface Props {
  results: Results;
  term: string;
  onOpenConversation: (displayId: number) => void;
  onOpenContact: (id: number) => void;
}

/** Chatwoot search result lists: conversations, contacts and messages with the term highlighted. */
export function SearchResults({ results, term, onOpenConversation, onOpenContact }: Props) {
  const { conversations = [], contacts = [], messages = [] } = results;
  return (
    <div className="flex flex-col gap-6">
      {conversations.length > 0 && (
        <Section title="Conversas" icon={<MessageCircle size={14} />}>
          {conversations.map((c) => (
            <Hit key={c.id} onClick={() => onOpenConversation(c.display_id)}>
              <Avatar name={c.contact_name || c.contact_phone} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-n-slate-12">
                  <Highlight text={`#${c.display_id}`} term={term} /> ·{' '}
                  <Highlight text={c.contact_name || c.contact_phone || 'Contato'} term={term} />
                </span>
                <span className="block truncate text-xs text-n-slate-11">
                  {c.inbox_name} · {STATUS_LABEL[c.status]} · {timeAgo(c.last_activity_at)}
                </span>
              </span>
            </Hit>
          ))}
        </Section>
      )}
      {contacts.length > 0 && (
        <Section title="Contatos" icon={<ContactIcon size={14} />}>
          {contacts.map((c) => (
            <Hit key={c.id} onClick={() => onOpenContact(c.id)}>
              <Avatar name={c.name || c.phone_number} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-n-slate-12">
                  <Highlight text={c.name || 'Sem nome'} term={term} />
                </span>
                <span className="block truncate text-xs text-n-slate-11">
                  <Highlight text={[c.phone_number, c.email].filter(Boolean).join(' · ')} term={term} />
                </span>
              </span>
            </Hit>
          ))}
        </Section>
      )}
      {messages.length > 0 && (
        <Section title="Mensagens" icon={<MessageSquareText size={14} />}>
          {messages.map((m) => (
            <Hit key={m.id} onClick={() => onOpenConversation(m.display_id)}>
              <Avatar name={m.contact_name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-n-slate-12">
                  {m.contact_name || 'Contato'} · #{m.display_id}
                  <span className="ml-2 text-xs font-normal text-n-slate-11">{timeAgo(m.created_at)}</span>
                </span>
                <span className="line-clamp-2 text-sm text-n-slate-11">
                  {m.message_type === 'outgoing' && 'Equipe: '}
                  <Highlight text={m.content} term={term} />
                </span>
              </span>
            </Hit>
          ))}
        </Section>
      )}
    </div>
  );
}
