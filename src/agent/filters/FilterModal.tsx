import { Fragment, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Catalog, FilterCondition, FilterType } from '../types';
import { useAttributeDefinitions } from '../attributes/useAttributeDefinitions';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Overlay';
import { ConditionRow } from './ConditionRow';
import { emptyCondition, filterAttributes, needsValue } from './filterAttributes';

interface Props {
  type: FilterType;
  catalog: Catalog;
  initial?: FilterCondition[];
  onApply: (conditions: FilterCondition[]) => void;
  onClose: () => void;
}

const TITLE: Record<FilterType, string> = { conversation: 'Filtrar conversas', contact: 'Filtrar contatos' };

/** Chatwoot advanced filter modal: condition rows joined by E/OU, then "Aplicar filtros". */
export function FilterModal({ type, catalog, initial, onApply, onClose }: Props) {
  const { definitions } = useAttributeDefinitions(type);
  const attributes = filterAttributes(type, catalog, definitions);
  const [rows, setRows] = useState<FilterCondition[]>(
    initial?.length ? initial : [emptyCondition(attributes[0])],
  );
  const [error, setError] = useState('');
  const update = (index: number, next: FilterCondition) =>
    setRows((list) => list.map((row, i) => (i === index ? next : row)));

  return (
    <Modal
      title={TITLE[type]}
      description="Adicione condições para refinar a lista; cada uma se liga à próxima por E ou OU."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (rows.some((r) => needsValue(r.filter_operator) && r.values.length === 0))
            return setError('Preencha o valor de todas as condições.');
          onApply(rows.map((r, i) => (i === rows.length - 1 ? { ...r, query_operator: 'and' } : r)));
        }}
      >
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <select
                className="field !h-7 !w-20 self-center !py-0 text-xs"
                aria-label={`Operador entre as condições ${i} e ${i + 1}`}
                value={rows[i - 1].query_operator}
                onChange={(e) => update(i - 1, { ...rows[i - 1], query_operator: e.target.value as 'and' })}
              >
                <option value="and">E</option>
                <option value="or">OU</option>
              </select>
            )}
            <ConditionRow
              index={i}
              condition={row}
              attributes={attributes}
              onChange={(next) => update(i, next)}
              onRemove={rows.length > 1 ? () => setRows((list) => list.filter((_, j) => j !== i)) : undefined}
            />
          </Fragment>
        ))}
        <Button
          color="blue"
          variant="link"
          size="xs"
          icon={Plus}
          label="Adicionar filtro"
          className="self-start"
          onClick={() => setRows((list) => [...list, emptyCondition(attributes[0])])}
        />
        {error && (
          <p role="alert" className="text-sm text-n-ruby-11">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-4">
          <Button color="slate" variant="faded" label="Cancelar" onClick={onClose} />
          <Button type="submit" label="Aplicar filtros" />
        </div>
      </form>
    </Modal>
  );
}
