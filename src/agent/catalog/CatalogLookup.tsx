import { useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { query } from '../api';
import { insertIntoComposer } from '../conversations/composer/composerBus';
import { Button } from '../ui/Button';
import { useFetch } from '../useFetch';
import { priceLabel } from './format';
import type { CatalogItem } from './types';
import { Badge } from './ui';

/** Conversation side panel: find a menu item and insert "name — price" into the reply box. */
export function CatalogLookup({ path }: { path: string }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const { data, error } = useFetch<CatalogItem[]>(
    term.length >= 2 ? `/catalog/search${query({ q: term })}` : null,
  );
  const results = term.length >= 2 ? (data || []).slice(0, 8) : [];
  return (
    <div className="flex flex-col gap-2">
      <label className="relative">
        <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-n-slate-10" />
        <input
          className="field !h-8 pl-8"
          value={q}
          aria-label="Buscar no catálogo"
          placeholder="Buscar item do cardápio…"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-n-ruby-11">{error}</p>}
      {term.length >= 2 && data && results.length === 0 && (
        <p className="text-xs text-n-slate-11">Nenhum item encontrado.</p>
      )}
      <ul className="flex flex-col gap-1">
        {results.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-n-alpha-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-n-slate-12">{item.product.name}</span>
              <span className="flex items-center gap-1 text-xs text-n-slate-11">
                {priceLabel(item)}
                {item.external_code && ` · PDV ${item.external_code}`}
                {!item.available_now && <Badge tone="amber">Indisponível agora</Badge>}
              </span>
            </span>
            <Button
              size="xs"
              color="slate"
              variant="faded"
              icon={CornerDownLeft}
              aria-label={`Inserir ${item.product.name} na resposta`}
              onClick={() => insertIntoComposer(path, `${item.product.name} — ${priceLabel(item)}`)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
