import { useState } from 'react';
import type { Macro, MacroVisibility } from '../accountTypes';
import type { Action, Catalog } from '../types';
import { ModalFooter } from '../ui/Settings';
import { ActionsEditor } from './ActionsEditor';
import { newAction } from './ruleOptions';

export interface MacroDraft {
  name: string;
  visibility: MacroVisibility;
  actions: Action[];
}

const VISIBILITY: { value: MacroVisibility; label: string; description: string }[] = [
  {
    value: 'personal',
    label: 'Privada',
    description: 'Esta macro será privada para você e não estará disponível para outras pessoas.',
  },
  {
    value: 'global',
    label: 'Pública',
    description: 'Esta macro está disponível para todos os agentes desta conta.',
  },
];

interface Props {
  macro?: Macro;
  catalog: Catalog;
  isAdmin: boolean;
  busy: boolean;
  error: string;
  onSave: (draft: MacroDraft) => void;
  onCancel: () => void;
}

/** Chatwoot MacroEditor: name, visibility (public only for administrators) and ordered actions. */
export function MacroEditor({ macro, catalog, isAdmin, busy, error, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<MacroDraft>({
    name: macro?.name || '',
    visibility: macro?.visibility || 'personal',
    actions: macro?.actions.length ? macro.actions : [newAction()],
  });
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <label>
        <span className="field-label">Nome da macro</span>
        <input
          className="field"
          value={draft.name}
          maxLength={120}
          required
          placeholder="Digite um nome para sua macro"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <fieldset>
        <legend className="field-label">Visibilidade da macro</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {VISIBILITY.map((v) => {
            const locked = v.value === 'global' && !isAdmin;
            return (
              <label
                key={v.value}
                className={`flex cursor-pointer gap-2 rounded-xl p-3 outline outline-1 -outline-offset-1 ${
                  draft.visibility === v.value ? 'outline-n-brand' : 'outline-n-weak'
                } ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="macro-visibility"
                  value={v.value}
                  disabled={locked}
                  checked={draft.visibility === v.value}
                  onChange={() => setDraft({ ...draft, visibility: v.value })}
                />
                <span>
                  <span className="block text-sm font-medium text-n-slate-12">{v.label}</span>
                  <span className="block text-xs text-n-slate-11">
                    {locked ? 'Somente administradores podem criar macros públicas.' : v.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <ActionsEditor
        actions={draft.actions}
        catalog={catalog}
        onChange={(actions) => setDraft((d) => ({ ...d, actions }))}
      />
      <p className="text-xs text-n-slate-11">As ações são executadas na ordem em que aparecem.</p>
      <ModalFooter busy={busy} submit="Salvar macro" onCancel={onCancel} error={error} />
    </form>
  );
}
