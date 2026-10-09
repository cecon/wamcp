import { useCallback, useEffect, useState } from 'react';
import { http, query } from '../api';
import type { AttributeDefinition, FilterType } from '../types';

/** Custom attribute definitions of one model (or all); failures leave the list empty. */
export function useAttributeDefinitions(model?: FilterType) {
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const reload = useCallback(
    () =>
      http<AttributeDefinition[]>(`/custom_attribute_definitions${query({ attribute_model: model })}`)
        .then(setDefinitions)
        .catch(() => setDefinitions([])),
    [model],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { definitions, reload };
}
