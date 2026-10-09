import { ArrowDown, ArrowUp, Copy } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Settings';
import { isRequired, money, priceLabel } from '../format';
import type { CatalogItem } from '../types';
import { Badge, Thumb } from '../ui';

interface Props {
  item: CatalogItem;
  editable: boolean;
  selected: boolean;
  /** Up/down buttons (hidden on search results, which mix categories). */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onSelect: (selected: boolean) => void;
  onOpen: () => void;
  onStatus: (available: boolean) => void;
  onDuplicate: () => void;
  onMove: (step: -1 | 1) => void;
}

/** One menu item: photo, name, price "de/por", PDV code, badges and quick actions. */
export function ItemRow({
  item,
  editable,
  selected,
  canMoveUp,
  canMoveDown,
  onSelect,
  onOpen,
  onStatus,
  onDuplicate,
  onMove,
}: Props) {
  const name = item.product.name;
  const paused = item.status === 'unavailable';
  return (
    <li className="flex items-center gap-3 rounded-xl bg-n-card p-3 outline outline-1 -outline-offset-1 outline-n-container">
      {editable && (
        <input
          type="checkbox"
          aria-label={`Selecionar ${name}`}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      )}
      <Thumb src={item.product.image_url} alt={name} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-full truncate text-left text-sm font-medium text-n-slate-12 hover:underline"
        >
          {name}
        </button>
        {item.product.description && (
          <p className="truncate text-xs text-n-slate-11">{item.product.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          {item.original_price_cents != null && (
            <s className="text-xs text-n-slate-10" aria-label="Preço original">
              {money(item.original_price_cents)}
            </s>
          )}
          <span className="font-medium text-n-slate-12">{priceLabel(item)}</span>
          {item.external_code && <span className="text-xs text-n-slate-10">PDV {item.external_code}</span>}
          {paused && <Badge tone="amber">Pausado</Badge>}
          {!paused && !item.available_now && <Badge tone="slate">Fora do horário</Badge>}
          {isRequired(item) && <Badge tone="blue">Obrigatório</Badge>}
        </div>
      </div>
      {editable && (
        <div className="flex shrink-0 items-center gap-1">
          <Toggle compact label={`Disponível: ${name}`} checked={!paused} onChange={onStatus} />
          <Button
            size="xs"
            color="slate"
            variant="ghost"
            icon={Copy}
            aria-label={`Duplicar ${name}`}
            onClick={onDuplicate}
          />
          {(canMoveUp || canMoveDown) && (
            <>
              <Button
                size="xs"
                color="slate"
                variant="ghost"
                icon={ArrowUp}
                aria-label={`Mover ${name} para cima`}
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              />
              <Button
                size="xs"
                color="slate"
                variant="ghost"
                icon={ArrowDown}
                aria-label={`Mover ${name} para baixo`}
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
