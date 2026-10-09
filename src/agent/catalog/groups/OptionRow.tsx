import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Settings';
import { PhotoField } from '../editor/PhotoField';
import type { OptionDraft, Product } from '../types';
import { MoneyInput } from '../ui';

/** An option being edited; `saved` is its stored product (photos need the product id). */
export type OptionRowDraft = OptionDraft & { saved?: Product };

interface Props {
  option: OptionRowDraft;
  index: number;
  count: number;
  editable: boolean;
  onChange: (patch: Partial<OptionRowDraft>) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}

/** One complement option: name, price, PDV code, max quantity, status and photo. */
export function OptionRow({ option, index, count, editable, onChange, onMove, onRemove }: Props) {
  const n = index + 1;
  return (
    <li
      aria-label={`Opção ${n}`}
      className="flex flex-col gap-2 rounded-lg p-3 outline outline-1 -outline-offset-1 outline-n-weak"
    >
      <div className="flex items-center gap-2">
        <input
          className="field !h-8 flex-1"
          aria-label={`Nome da opção ${n}`}
          maxLength={120}
          value={option.product.name}
          onChange={(e) => onChange({ product: { ...option.product, name: e.target.value } })}
        />
        <Toggle
          compact
          label={`Opção ${n} disponível`}
          checked={option.status === 'available'}
          onChange={(on) => onChange({ status: on ? 'available' : 'unavailable' })}
        />
        {editable && (
          <>
            <Button
              size="xs"
              color="slate"
              variant="ghost"
              icon={ArrowUp}
              aria-label={`Subir opção ${n}`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            />
            <Button
              size="xs"
              color="slate"
              variant="ghost"
              icon={ArrowDown}
              aria-label={`Descer opção ${n}`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            />
            <Button
              size="xs"
              color="ruby"
              variant="ghost"
              icon={Trash2}
              aria-label={`Remover opção ${n}`}
              onClick={onRemove}
            />
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MoneyInput
          compact
          label={`Preço da opção ${n}`}
          value={option.price_cents}
          onChange={(cents) => onChange({ price_cents: cents ?? 0 })}
        />
        <input
          className="field !h-8"
          aria-label={`Código PDV da opção ${n}`}
          placeholder="Código PDV"
          maxLength={60}
          value={option.external_code || ''}
          onChange={(e) => onChange({ external_code: e.target.value.trim() || null })}
        />
        <input
          className="field !h-8"
          type="number"
          min={1}
          aria-label={`Quantidade máxima da opção ${n}`}
          title="Quantas vezes a mesma opção pode ser escolhida"
          value={option.max_quantity}
          onChange={(e) => onChange({ max_quantity: Number(e.target.value) })}
        />
      </div>
      {option.saved && <PhotoField product={option.saved} editable={editable} onChanged={() => {}} />}
    </li>
  );
}
