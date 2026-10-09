import { useCallback, useEffect, useState } from 'react';
import { http } from '../api';
import type { Macro } from '../accountTypes';
import type { BulkResult } from '../types';

/** Global macros plus the agent's personal ones (GET /macros). */
export function useMacros() {
  const [macros, setMacros] = useState<Macro[] | null>(null),
    [error, setError] = useState('');
  const reload = useCallback(
    () =>
      http<Macro[]>('/macros')
        .then((list) => {
          setMacros(list);
          setError('');
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { macros: macros || [], loaded: macros !== null, error, reload };
}

/** Runs a macro on conversations (display ids) as the current agent. */
export const executeMacro = (macro: Macro, displayIds: number[]) =>
  http<BulkResult>(`/macros/${macro.id}/execute`, 'POST', { conversation_ids: displayIds });

export const VISIBILITY_LABEL: Record<Macro['visibility'], string> = {
  global: 'Pública',
  personal: 'Privada',
};
