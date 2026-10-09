import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { money } from '../format';
import type { Menu } from '../types';
import { MoneyInput, Section } from '../ui';
import type { ComboDraft } from './itemDraft';

interface Props {
  combo: ComboDraft;
  menu: Menu;
  onChange: (combo: ComboDraft) => void;
}

/** Combo main group: menu items the customer chooses from (each keeps its own complements). */
export function ComboSection({ combo, menu, onChange }: Props) {
  const [pick, setPick] = useState('');
  const items = menu.categories.filter((c) => c.template !== 'combo').flatMap((c) => c.items);
  const choices = items.filter((i) => !combo.entries.some((e) => e.item_id === i.id));
  const entries = combo.entries;
  const add = () => {
    const item = items.find((i) => String(i.id) === pick);
    if (!item) return;
    onChange({
      ...combo,
      entries: [...entries, { item_id: item.id, name: item.product.name, price_cents: 0 }],
    });
    setPick('');
  };
  return (
    <Section title="Itens do combo">
      <p className="text-xs text-n-slate-11">
        O cliente escolhe um destes itens; o preço é o do combo mais o acréscimo de cada escolha.
      </p>
      {entries.length === 0 && <p className="text-sm text-n-slate-11">Nenhum item no combo.</p>}
      <ul className="flex flex-col gap-2">
        {entries.map((e, i) => {
          const source = items.find((x) => x.id === e.item_id);
          return (
            <li key={e.item_id} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
              <span className="truncate text-sm text-n-slate-12">
                {e.name}
                {source && (
                  <span className="ml-1 text-xs text-n-slate-10">({money(source.price_cents)} avulso)</span>
                )}
              </span>
              <MoneyInput
                compact
                label={`Acréscimo de ${e.name}`}
                value={e.price_cents}
                onChange={(cents) =>
                  onChange({
                    ...combo,
                    entries: entries.map((x, j) => (i === j ? { ...x, price_cents: cents ?? 0 } : x)),
                  })
                }
              />
              <Button
                size="xs"
                color="ruby"
                variant="ghost"
                icon={Trash2}
                aria-label={`Remover ${e.name} do combo`}
                onClick={() => onChange({ ...combo, entries: entries.filter((_, j) => j !== i) })}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <select
          className="field !h-8 !py-0"
          aria-label="Item do cardápio"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">Escolha um item do cardápio…</option>
          {choices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.product.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="faded" label="Adicionar ao combo" disabled={!pick} onClick={add} />
      </div>
    </Section>
  );
}
