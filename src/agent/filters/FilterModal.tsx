import { Fragment, useState } from 'react';

// material-ui
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';

// third-party
import { Plus } from 'lucide-react';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import type { Catalog, FilterCondition, FilterType } from '../types';
import { useAttributeDefinitions } from '../attributes/useAttributeDefinitions';
import C3Provider from '../c3/C3Provider';
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
  const submit = () => {
    if (rows.some((r) => needsValue(r.filter_operator) && r.values.length === 0))
      return setError('Preencha o valor de todas as condições.');
    onApply(rows.map((r, i) => (i === rows.length - 1 ? { ...r, query_operator: 'and' } : r)));
  };

  return (
    <C3Provider>
      <ActionDialog
        open
        title={TITLE[type]}
        description="Adicione condições para refinar a lista; cada uma se liga à próxima por E ou OU."
        confirmLabel="Aplicar filtros"
        backLabel="Cancelar"
        error={error}
        onClose={onClose}
        onConfirm={submit}
      >
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {rows.map((row, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <Select
                  native
                  size="small"
                  value={rows[i - 1].query_operator}
                  inputProps={{ 'aria-label': `Operador entre as condições ${i} e ${i + 1}` }}
                  onChange={(event) =>
                    update(i - 1, {
                      ...rows[i - 1],
                      query_operator: String(event.target.value) as FilterCondition['query_operator'],
                    })
                  }
                  sx={{ alignSelf: 'center', width: 80, fontSize: 12 }}
                >
                  <option value="and">E</option>
                  <option value="or">OU</option>
                </Select>
              )}
              <ConditionRow
                index={i}
                condition={row}
                attributes={attributes}
                onChange={(next) => update(i, next)}
                onRemove={
                  rows.length > 1 ? () => setRows((list) => list.filter((_, j) => j !== i)) : undefined
                }
              />
            </Fragment>
          ))}
          <Button
            size="small"
            variant="text"
            startIcon={<Plus size={14} />}
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setRows((list) => [...list, emptyCondition(attributes[0])])}
          >
            Adicionar filtro
          </Button>
        </Stack>
      </ActionDialog>
    </C3Provider>
  );
}
