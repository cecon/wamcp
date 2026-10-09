import { useState } from 'react';
import type { Inbox } from '../types';
import { Button } from '../ui/Button';

interface Props {
  inbox: Inbox;
  busy: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<boolean>;
}

/** Chatwoot "Limite de conversas por agente" of the automatic assignment (empty = no limit). */
export function InboxLimit({ inbox, busy, onSave }: Props) {
  const initial = inbox.max_assignment_limit ? String(inbox.max_assignment_limit) : '';
  const [limit, setLimit] = useState(initial),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 border-t border-n-weak py-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void onSave({ max_assignment_limit: limit.trim() ? Number(limit) : null }).then(setSaved);
      }}
    >
      <label>
        <span className="text-heading-3 block text-n-slate-12">Limite de conversas por agente</span>
        <span className="mb-2 block text-sm text-n-slate-11">
          Máximo de conversas abertas que a atribuição automática entrega a cada agente. Deixe vazio para não
          limitar.
        </span>
        <span className="flex items-center gap-2">
          <input
            className="field !w-40"
            type="number"
            min={1}
            max={1000}
            placeholder="Sem limite"
            value={limit}
            onChange={(e) => {
              setSaved(false);
              setLimit(e.target.value);
            }}
          />
          <Button
            type="submit"
            size="md"
            color="slate"
            label="Salvar limite"
            disabled={busy || limit === initial}
          />
        </span>
      </label>
      {saved && <p className="text-sm text-n-teal-11">Limite salvo.</p>}
    </form>
  );
}
