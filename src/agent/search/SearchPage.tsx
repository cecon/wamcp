import { useState } from 'react';
import { Search } from 'lucide-react';
import type { SearchResults as Results, SearchType } from '../parityTypes';
import { SettingsPage } from '../ui/Settings';
import { cn } from '../ui/cn';
import { SearchResults } from './SearchResults';
import { MIN_CHARS, useSearch } from './useSearch';

const TABS: { type: SearchType; label: string }[] = [
  { type: 'all', label: 'Todos' },
  { type: 'conversations', label: 'Conversas' },
  { type: 'contacts', label: 'Contatos' },
  { type: 'messages', label: 'Mensagens' },
];

const total = (r: Results) =>
  (r.conversations?.length || 0) + (r.contacts?.length || 0) + (r.messages?.length || 0);

interface Props {
  onOpenConversation: (displayId: number) => void;
  onOpenContact: (id: number) => void;
}

/** Chatwoot search page: term field, result type tabs and the grouped results. */
export function SearchPage({ onOpenConversation, onOpenContact }: Props) {
  const [text, setText] = useState(''),
    [type, setType] = useState<SearchType>('all');
  const { term, results, error, searching } = useSearch(text, type);
  return (
    <SettingsPage>
      <h1 className="text-heading-1 pt-2 text-n-slate-12">Pesquisar</h1>
      <label className="flex h-10 items-center gap-2 rounded-lg bg-n-alpha-black2 px-3 outline outline-1 -outline-offset-1 outline-n-weak focus-within:outline-n-brand">
        <Search size={16} className="shrink-0 text-n-slate-10" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Pesquisar mensagens, contatos ou conversas"
          placeholder="Pesquise mensagens, contatos ou conversas (#12 abre a conversa 12)"
          className="w-full min-w-0 bg-transparent text-sm text-n-slate-12 outline-none placeholder:text-n-slate-10"
        />
      </label>
      <nav role="tablist" className="flex gap-4 border-b border-n-weak">
        {TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            role="tab"
            aria-selected={type === t.type}
            onClick={() => setType(t.type)}
            className={cn(
              'relative py-2.5 text-sm font-medium',
              type === t.type ? 'text-n-blue-11' : 'text-n-slate-11 hover:text-n-slate-12',
            )}
          >
            {t.label}
            {type === t.type && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-n-brand" />
            )}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      {text.trim().length < MIN_CHARS ? (
        <p className="py-12 text-center text-sm text-n-slate-11">
          Digite ao menos {MIN_CHARS} caracteres para pesquisar.
        </p>
      ) : searching && !results ? (
        <p className="py-12 text-center text-sm text-n-slate-11">Pesquisando…</p>
      ) : results && total(results) > 0 ? (
        <SearchResults
          results={results}
          term={term}
          onOpenConversation={onOpenConversation}
          onOpenContact={onOpenContact}
        />
      ) : (
        !searching && (
          <p className="py-12 text-center text-sm text-n-slate-11">Nenhum resultado para “{term}”.</p>
        )
      )}
    </SettingsPage>
  );
}
